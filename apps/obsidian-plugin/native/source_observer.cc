#include <node_api.h>

#include <cstdint>
#include <cmath>
#include <new>
#include <string>
#include <vector>

#if defined(CHAT2VAULT_NATIVE_TESTING)
#include <atomic>
#endif

#if defined(__APPLE__)
#include <sys/attr.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <cerrno>
#include <unistd.h>
#include <stdio.h>
#elif defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

namespace {

napi_value String(napi_env env, const char* value) {
  napi_value result;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value Kind(napi_env env, const char* kind) {
  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "kind", String(env, kind));
  return result;
}

bool FatalUtf8(const uint8_t* bytes, size_t length) {
  for (size_t index = 0; index < length;) {
    const uint8_t first = bytes[index++];
    if (first <= 0x7f) continue;
    uint32_t point = 0;
    size_t continuation = 0;
    if (first >= 0xc2 && first <= 0xdf) {
      point = first & 0x1f;
      continuation = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      point = first & 0x0f;
      continuation = 2;
    } else if (first >= 0xf0 && first <= 0xf4) {
      point = first & 0x07;
      continuation = 3;
    } else {
      return false;
    }
    if (index + continuation > length) return false;
    for (size_t offset = 0; offset < continuation; ++offset) {
      const uint8_t next = bytes[index++];
      if ((next & 0xc0) != 0x80) return false;
      point = (point << 6) | (next & 0x3f);
    }
    if ((continuation == 1 && point < 0x80) ||
        (continuation == 2 && point < 0x800) ||
        (continuation == 3 && point < 0x10000) ||
        (point >= 0xd800 && point <= 0xdfff) || point > 0x10ffff)
      return false;
  }
  return true;
}

std::string Hex(const uint8_t* bytes, size_t length) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string result;
  result.reserve(length * 2);
  for (size_t index = 0; index < length; ++index) {
    result.push_back(digits[bytes[index] >> 4]);
    result.push_back(digits[bytes[index] & 0x0f]);
  }
  return result;
}

bool Utf8Argument(napi_env env, napi_callback_info info, std::string* output) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) return false;
  napi_valuetype type;
  if (napi_typeof(env, argv[0], &type) != napi_ok || type != napi_string) return false;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length) != napi_ok) return false;
  std::vector<char> bytes(length + 1);
  if (napi_get_value_string_utf8(env, argv[0], bytes.data(), bytes.size(), &length) != napi_ok) return false;
  output->assign(bytes.data(), length);
  return output->find('\0') == std::string::npos;
}

#if defined(__APPLE__)
bool SameIdentity(const struct stat& left, const struct stat& right) {
  return left.st_dev == right.st_dev && left.st_ino == right.st_ino &&
         left.st_size == right.st_size &&
         left.st_mtimespec.tv_sec == right.st_mtimespec.tv_sec &&
         left.st_mtimespec.tv_nsec == right.st_mtimespec.tv_nsec &&
         left.st_ctimespec.tv_sec == right.st_ctimespec.tv_sec &&
         left.st_ctimespec.tv_nsec == right.st_ctimespec.tv_nsec;
}

bool SameNode(const struct stat& left, const struct stat& right) {
  return left.st_dev == right.st_dev && left.st_ino == right.st_ino;
}

int RetryFstatAt(int directory, const char* path, struct stat* result,
                 int flags) {
  int status;
  do {
    status = fstatat(directory, path, result, flags);
  } while (status != 0 && errno == EINTR);
  return status;
}

int RetryFstat(int descriptor, struct stat* result) {
  int status;
  do {
    status = fstat(descriptor, result);
  } while (status != 0 && errno == EINTR);
  return status;
}

int RetryFchmod(int descriptor, mode_t mode) {
  int status;
  do {
    status = fchmod(descriptor, mode);
  } while (status != 0 && errno == EINTR);
  return status;
}

int RetryOpenAt(int directory, const char* path, int flags) {
  int result;
  do {
    result = openat(directory, path, flags);
  } while (result < 0 && errno == EINTR);
  return result;
}

int RetryCreateAt(int directory, const char* path, int flags, mode_t mode) {
  int result;
  do {
    result = openat(directory, path, flags, mode);
  } while (result < 0 && errno == EINTR);
  return result;
}

std::string Device(const struct stat& value) {
  return std::to_string(static_cast<uint64_t>(value.st_dev));
}

std::string Inode(const struct stat& value) {
  return std::to_string(static_cast<uint64_t>(value.st_ino));
}

bool ExpectedNode(const struct stat& value, const std::string& device,
                  const std::string& inode) {
  return Device(value) == device && Inode(value) == inode;
}

bool SafeRelativePath(const std::string& path, std::vector<std::string>* parts) {
  if (path.empty() || path.front() == '/' || path.find('\\') != std::string::npos) return false;
  size_t start = 0;
  while (start < path.size()) {
    const size_t end = path.find('/', start);
    const std::string part = path.substr(start, end == std::string::npos ? end : end - start);
    if (part.empty() || part == "." || part == "..") return false;
    parts->push_back(part);
    if (end == std::string::npos) return true;
    start = end + 1;
  }
  return false;
}

// Walk from a held vault-root descriptor; no path component may be a symlink.
int OpenContainedFile(int root, const std::vector<std::string>& parts) {
  int parent = dup(root);
  if (parent < 0) return -1;
  for (size_t index = 0; index < parts.size(); ++index) {
    const bool leaf = index + 1 == parts.size();
    const int next = openat(parent, parts[index].c_str(),
                            O_RDONLY | O_NOFOLLOW | O_CLOEXEC | (leaf ? O_NONBLOCK : O_DIRECTORY));
    close(parent);
    if (next < 0) return -1;
    parent = next;
  }
  return parent;
}

bool LstatContainedFile(int root, const std::vector<std::string>& parts, struct stat* result) {
  int parent = dup(root);
  if (parent < 0) return false;
  for (size_t index = 0; index + 1 < parts.size(); ++index) {
    const int next = openat(parent, parts[index].c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(parent);
    if (next < 0) return false;
    parent = next;
  }
  const bool success = fstatat(parent, parts.back().c_str(), result, AT_SYMLINK_NOFOLLOW) == 0;
  close(parent);
  return success;
}

struct BoundedReadWork {
  napi_async_work handle = nullptr;
  napi_deferred deferred = nullptr;
  std::string root_path;
  std::string relative_path;
  std::vector<std::string> parts;
  size_t limit = 0;
  std::vector<uint8_t> bytes;
  size_t size = 0;
  bool safe = false;
};

struct ExclusivePublishWork {
  napi_async_work handle = nullptr;
  napi_deferred deferred = nullptr;
  std::string root_path;
  std::string parent_path;
  std::vector<std::string> parent_parts;
  std::string config_path;
  std::vector<std::string> config_parts;
  std::string target_name;
  std::string expected_root_device;
  std::string expected_root_inode;
  std::string expected_parent_device;
  std::string expected_parent_inode;
  std::string expected_config_device;
  std::string expected_config_inode;
  std::vector<uint8_t> bytes;
  std::string result = "failed";
  std::string effect;
  std::string temporary_path;
  std::string temporary_device;
  std::string temporary_inode;
#if defined(CHAT2VAULT_NATIVE_TESTING)
  std::string test_fault;
#endif
};

#if defined(CHAT2VAULT_NATIVE_TESTING)
std::atomic<int> test_barrier_state{0};

bool AwaitTestBarrierRelease() {
  test_barrier_state.store(1);
  for (size_t attempt = 0; attempt < 5000; ++attempt) {
    if (test_barrier_state.load() == 2) {
      test_barrier_state.store(0);
      return true;
    }
    usleep(1000);
  }
  test_barrier_state.store(0);
  return false;
}
#endif

// N-API calls stay on the main thread. The complete filesystem transaction runs here.
void ExecuteBoundedRead(napi_env, void* data) {
  auto* work = static_cast<BoundedReadWork*>(data);
  const int root = open(work->root_path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) return;
  struct stat root_before{}, root_after{}, path_before{}, path_after{}, fd_before{}, fd_after{};
  bool safe = fstat(root, &root_before) == 0 && S_ISDIR(root_before.st_mode);
  int file = safe ? OpenContainedFile(root, work->parts) : -1;
  safe = safe && file >= 0 && fstat(file, &fd_before) == 0 && S_ISREG(fd_before.st_mode) &&
         LstatContainedFile(root, work->parts, &path_before) && S_ISREG(path_before.st_mode) &&
         SameIdentity(fd_before, path_before);
  if (safe) {
    const int observed = OpenContainedFile(root, work->parts);
    safe = observed >= 0 && fstat(observed, &path_before) == 0 && SameIdentity(fd_before, path_before);
    if (observed >= 0) close(observed);
  }
  size_t offset = 0;
  if (safe) {
    try {
      work->bytes.resize(work->limit);
    } catch (...) {
      safe = false;
    }
  }
  while (safe && offset < work->limit) {
    const ssize_t count = pread(file, work->bytes.data() + offset, work->limit - offset, static_cast<off_t>(offset));
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) safe = false;
    if (count <= 0) break;
    offset += static_cast<size_t>(count);
  }
  if (safe) {
    const int observed = OpenContainedFile(root, work->parts);
    const int current_root = open(work->root_path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    safe = observed >= 0 && current_root >= 0 &&
           fstat(file, &fd_after) == 0 && fstat(observed, &path_after) == 0 &&
           fstat(current_root, &root_after) == 0 &&
           SameIdentity(root_before, root_after) && SameIdentity(fd_before, fd_after) &&
           SameIdentity(fd_before, path_after);
    struct stat lstat_after{};
    safe = safe && LstatContainedFile(root, work->parts, &lstat_after) &&
           S_ISREG(lstat_after.st_mode) && SameIdentity(fd_before, lstat_after);
    if (observed >= 0) close(observed);
    if (current_root >= 0) close(current_root);
  }
  if (file >= 0) close(file);
  close(root);
  work->safe = safe;
  work->size = offset;
}

void CompleteBoundedRead(napi_env env, napi_status status, void* data) {
  auto* work = static_cast<BoundedReadWork*>(data);
  napi_value result = Kind(env, "unavailable");
  if (status == napi_ok && work->safe) {
    void* copied = nullptr;
    napi_value buffer;
    if (napi_create_buffer_copy(env, work->size, work->bytes.data(), &copied, &buffer) == napi_ok)
      result = buffer;
  }
  napi_resolve_deferred(env, work->deferred, result);
  napi_delete_async_work(env, work->handle);
  delete work;
}

bool HierarchyCurrent(const ExclusivePublishWork* work, int held_root,
                      int held_parent, int held_config) {
  struct stat root_stat{}, parent_stat{}, config_stat{}, current_root_stat{},
      current_parent_stat{}, current_config_stat{};
  const int current_root = open(work->root_path.c_str(),
                                O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  const int current_parent = current_root < 0
                                 ? -1
                                 : OpenContainedFile(current_root, work->parent_parts);
  const int current_config = current_root < 0
                                 ? -1
                                 : OpenContainedFile(current_root, work->config_parts);
  const bool current = current_root >= 0 && current_parent >= 0 &&
                       current_config >= 0 &&
                       fstat(held_root, &root_stat) == 0 &&
                       fstat(held_parent, &parent_stat) == 0 &&
                       fstat(held_config, &config_stat) == 0 &&
                       fstat(current_root, &current_root_stat) == 0 &&
                       fstat(current_parent, &current_parent_stat) == 0 &&
                       fstat(current_config, &current_config_stat) == 0 &&
                       SameNode(root_stat, current_root_stat) &&
                       SameNode(parent_stat, current_parent_stat) &&
                       SameNode(config_stat, current_config_stat) &&
                       ExpectedNode(current_root_stat,
                                    work->expected_root_device,
                                    work->expected_root_inode) &&
                       ExpectedNode(current_parent_stat,
                                    work->expected_parent_device,
                                    work->expected_parent_inode) &&
                       ExpectedNode(current_config_stat,
                                    work->expected_config_device,
                                    work->expected_config_inode);
  if (current_parent >= 0) close(current_parent);
  if (current_config >= 0) close(current_config);
  if (current_root >= 0) close(current_root);
  return current;
}

bool ExactFileBytes(int file, const std::vector<uint8_t>& expected) {
  struct stat value{};
  if (fstat(file, &value) != 0 || !S_ISREG(value.st_mode) ||
      value.st_size != static_cast<off_t>(expected.size()))
    return false;
  std::vector<uint8_t> observed;
  try {
    observed.resize(expected.size());
  } catch (...) {
    return false;
  }
  size_t offset = 0;
  while (offset < observed.size()) {
    const ssize_t count = pread(file, observed.data() + offset,
                                observed.size() - offset,
                                static_cast<off_t>(offset));
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    offset += static_cast<size_t>(count);
  }
  return observed == expected;
}

void ExecuteExclusivePublish(napi_env, void* data) {
  auto* work = static_cast<ExclusivePublishWork*>(data);
  const int root = open(work->root_path.c_str(),
                        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) return;
  const int parent = OpenContainedFile(root, work->parent_parts);
  const int config = OpenContainedFile(root, work->config_parts);
  struct stat root_stat{}, parent_stat{}, config_stat{};
  bool safe = parent >= 0 && config >= 0 && fstat(root, &root_stat) == 0 &&
              fstat(parent, &parent_stat) == 0 &&
              fstat(config, &config_stat) == 0 &&
              S_ISDIR(root_stat.st_mode) && S_ISDIR(parent_stat.st_mode) &&
              S_ISDIR(config_stat.st_mode) &&
              ExpectedNode(root_stat, work->expected_root_device,
                           work->expected_root_inode) &&
              ExpectedNode(parent_stat, work->expected_parent_device,
                           work->expected_parent_inode) &&
              ExpectedNode(config_stat, work->expected_config_device,
                           work->expected_config_inode);
  if (!safe) {
    if (parent >= 0) close(parent);
    if (config >= 0) close(config);
    close(root);
    return;
  }

  // The descriptor returned by exclusive creation is the only authority used
  // for payload writes. A later same-name replacement is never opened or
  // cleaned up by this operation.
  std::string temporary_name;
  int file = -1;
  for (size_t attempt = 0; attempt < 32 && file < 0; ++attempt) {
    const uint64_t nonce = (static_cast<uint64_t>(arc4random()) << 32) |
                           static_cast<uint64_t>(arc4random());
    temporary_name = ".chat2vault-private-" + std::to_string(nonce);
    file = RetryCreateAt(parent, temporary_name.c_str(),
                         O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                         S_IRUSR | S_IWUSR);
    if (file < 0) {
      if (errno == EEXIST) continue;
      break;
    }
    work->temporary_path = work->parent_path + "/" + temporary_name;
  }

  struct stat created{};
  safe = file >= 0;
#if defined(CHAT2VAULT_NATIVE_TESTING)
  if (safe && work->test_fault == "barrier-after-temporary-mkdir")
    safe = AwaitTestBarrierRelease();
  if (work->test_fault == "temporary-identity") safe = false;
#endif
  safe = safe && RetryFstat(file, &created) == 0 && S_ISREG(created.st_mode);
  if (safe) {
    work->temporary_device = Device(created);
    work->temporary_inode = Inode(created);
  }
  struct stat secured{};
  safe = safe && RetryFchmod(file, S_IRUSR | S_IWUSR) == 0 &&
         RetryFstat(file, &secured) == 0 && SameNode(created, secured) &&
         (secured.st_mode & (S_IRWXU | S_IRWXG | S_IRWXO)) ==
             (S_IRUSR | S_IWUSR);
  size_t offset = 0;
#if defined(CHAT2VAULT_NATIVE_TESTING)
  const size_t write_limit = work->test_fault == "partial-write"
                                 ? work->bytes.size() / 2
                                 : work->bytes.size();
#else
  const size_t write_limit = work->bytes.size();
#endif
  while (safe && offset < write_limit) {
    const ssize_t count = write(file, work->bytes.data() + offset,
                                write_limit - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) {
      safe = false;
      break;
    }
    offset += static_cast<size_t>(count);
  }
  safe = safe && offset == work->bytes.size();
#if defined(CHAT2VAULT_NATIVE_TESTING)
  safe = safe && work->test_fault != "file-fsync" && fsync(file) == 0 &&
         work->test_fault != "temporary-readback" &&
         ExactFileBytes(file, work->bytes) &&
         work->test_fault != "directory-fsync" && fsync(parent) == 0;
#else
  safe = safe && fsync(file) == 0 && ExactFileBytes(file, work->bytes) &&
         fsync(parent) == 0;
#endif
  safe = safe && HierarchyCurrent(work, root, parent, config);
#if defined(CHAT2VAULT_NATIVE_TESTING)
  if (safe && work->test_fault == "barrier-before-publish")
    safe = AwaitTestBarrierRelease() &&
           HierarchyCurrent(work, root, parent, config);
  if (work->test_fault == "cleanup") safe = false;
#endif
  struct stat named_temporary{};
  safe = safe &&
         RetryFstatAt(parent, temporary_name.c_str(), &named_temporary,
                      AT_SYMLINK_NOFOLLOW) == 0 &&
         S_ISREG(named_temporary.st_mode) && SameNode(created, named_temporary);
  if (!safe) {
    work->result = file >= 0 ? "uncertain" : "failed";
    if (file >= 0) work->effect = "temporary";
    if (file >= 0) close(file);
    close(parent);
    close(config);
    close(root);
    return;
  }

  if (renameatx_np(parent, temporary_name.c_str(), parent,
                   work->target_name.c_str(), RENAME_EXCL) != 0) {
    work->result = "uncertain";
    work->effect = "temporary";
    close(file);
    close(parent);
    close(config);
    close(root);
    return;
  }

  struct stat published{};
  const int reopened = openat(parent, work->target_name.c_str(),
                              O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
  const bool verified =
#if defined(CHAT2VAULT_NATIVE_TESTING)
                        work->test_fault != "published-readback" &&
#endif
                        reopened >= 0 &&
                        fstat(reopened, &published) == 0 &&
                        SameNode(created, published) &&
                        ExactFileBytes(reopened, work->bytes) &&
                        fsync(parent) == 0 &&
                        HierarchyCurrent(work, root, parent, config);
  work->result = verified ? "published" : "uncertain";
  if (!verified) work->effect = "published";
  if (reopened >= 0) close(reopened);
  close(file);
  close(parent);
  close(config);
  close(root);
}

void CompleteExclusivePublish(napi_env env, napi_status status, void* data) {
  auto* work = static_cast<ExclusivePublishWork*>(data);
  const bool completion_uncertain = status != napi_ok;
  napi_value result = Kind(env, completion_uncertain ? "uncertain"
                                                      : work->result.c_str());
  if (completion_uncertain)
    napi_set_named_property(env, result, "effect", String(env, "published"));
  else if (!work->effect.empty()) {
    napi_set_named_property(env, result, "effect",
                            String(env, work->effect.c_str()));
    if (work->effect == "temporary" && !work->temporary_path.empty() &&
        !completion_uncertain) {
      napi_value artifact;
      napi_create_object(env, &artifact);
      napi_set_named_property(env, artifact, "path",
                              String(env, work->temporary_path.c_str()));
      napi_set_named_property(env, artifact, "ownership",
                              String(env, "unverified"));
      if (!work->temporary_device.empty() && !work->temporary_inode.empty()) {
        napi_value identity;
        napi_create_object(env, &identity);
        napi_set_named_property(env, identity, "device",
                                String(env, work->temporary_device.c_str()));
        napi_set_named_property(env, identity, "inode",
                                String(env, work->temporary_inode.c_str()));
        napi_set_named_property(env, artifact, "identity", identity);
      }
      napi_set_named_property(env, result, "temporaryArtifact", artifact);
    }
  }
  napi_resolve_deferred(env, work->deferred, result);
  napi_delete_async_work(env, work->handle);
  delete work;
}

bool ValidUtf16String(napi_env env, napi_value value, std::string* result) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return false;
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok || length > 4096) return false;
  std::vector<char16_t> units(length + 1);
  if (napi_get_value_string_utf16(env, value, units.data(), units.size(), &length) != napi_ok) return false;
  for (size_t index = 0; index < length; ++index) {
    const char16_t unit = units[index];
    if (unit == 0) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (++index >= length || units[index] < 0xdc00 || units[index] > 0xdfff) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  size_t bytes_length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &bytes_length) != napi_ok) return false;
  std::vector<char> bytes(bytes_length + 1);
  if (napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &bytes_length) != napi_ok) return false;
  result->assign(bytes.data(), bytes_length);
  return FatalUtf8(reinterpret_cast<const uint8_t*>(result->data()), result->size());
}

napi_value ReadVaultFileBounded(napi_env env, napi_callback_info info) {
  napi_value promise;
  napi_deferred deferred;
  if (napi_create_promise(env, &deferred, &promise) != napi_ok) return Kind(env, "unavailable");
  auto unavailable = [&]() -> napi_value {
    napi_resolve_deferred(env, deferred, Kind(env, "unavailable"));
    return promise;
  };
#if defined(CHAT2VAULT_NATIVE_TESTING)
  size_t argc = 4;
  napi_value argv[4];
#else
  size_t argc = 3;
  napi_value argv[3];
#endif
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      (argc != 3
#if defined(CHAT2VAULT_NATIVE_TESTING)
       && argc != 4
#endif
       ))
    return unavailable();
#if defined(CHAT2VAULT_NATIVE_TESTING)
  std::string test_fault;
  if (argc == 4 && !ValidUtf16String(env, argv[3], &test_fault))
    return unavailable();
#endif
  auto* work = new (std::nothrow) BoundedReadWork();
  if (work == nullptr) return unavailable();
  work->deferred = deferred;
  double max_double = -1;
  napi_valuetype max_type;
  if (!ValidUtf16String(env, argv[0], &work->root_path) ||
      !ValidUtf16String(env, argv[1], &work->relative_path) ||
      napi_typeof(env, argv[2], &max_type) != napi_ok || max_type != napi_number ||
      napi_get_value_double(env, argv[2], &max_double) != napi_ok ||
      !std::isfinite(max_double) || max_double < 0 || max_double > 1064960 ||
      std::trunc(max_double) != max_double ||
      work->root_path.empty() || work->root_path.front() != '/' ||
      !SafeRelativePath(work->relative_path, &work->parts)) {
    delete work;
    return unavailable();
  }
  work->limit = static_cast<size_t>(max_double) + 1;
  napi_value resource_name = String(env, "Chat2Vault bounded vault read");
  if (napi_create_async_work(env, nullptr, resource_name, ExecuteBoundedRead, CompleteBoundedRead,
                             work, &work->handle) != napi_ok) {
    delete work;
    return unavailable();
  }
  if (
#if defined(CHAT2VAULT_NATIVE_TESTING)
      test_fault == "queue-failure" ||
#endif
      napi_queue_async_work(env, work->handle) != napi_ok) {
    napi_delete_async_work(env, work->handle);
    delete work;
    return unavailable();
  }
  return promise;
}

napi_value ObserveVaultIdentity(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  std::string root_path;
  std::string relative_path;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc != 2 || !ValidUtf16String(env, argv[0], &root_path) ||
      !ValidUtf16String(env, argv[1], &relative_path) || root_path.empty() ||
      root_path.front() != '/')
    return Kind(env, "unavailable");
  std::vector<std::string> parts;
  if (!relative_path.empty() && !SafeRelativePath(relative_path, &parts))
    return Kind(env, "unavailable");
  const int root = open(root_path.c_str(),
                        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) return Kind(env, "unavailable");
  const int value = relative_path.empty() ? dup(root)
                                          : OpenContainedFile(root, parts);
  struct stat root_stat{}, value_stat{};
  const bool safe = value >= 0 && fstat(root, &root_stat) == 0 &&
                    fstat(value, &value_stat) == 0 &&
                    S_ISDIR(root_stat.st_mode) &&
                    (S_ISDIR(value_stat.st_mode) ||
                     S_ISREG(value_stat.st_mode));
  if (value >= 0) close(value);
  close(root);
  if (!safe) return Kind(env, "unavailable");
  napi_value result = Kind(env, "identity");
  const std::string device = Device(value_stat);
  const std::string inode = Inode(value_stat);
  napi_set_named_property(env, result, "device", String(env, device.c_str()));
  napi_set_named_property(env, result, "inode", String(env, inode.c_str()));
  return result;
}

napi_value PublishVaultFileExclusive(napi_env env, napi_callback_info info) {
  napi_value promise;
  napi_deferred deferred;
  if (napi_create_promise(env, &deferred, &promise) != napi_ok) return Kind(env, "unavailable");
  auto unavailable = [&]() -> napi_value {
    napi_resolve_deferred(env, deferred, Kind(env, "unavailable"));
    return promise;
  };
#if defined(CHAT2VAULT_NATIVE_TESTING)
  size_t argc = 12;
  napi_value argv[12];
#else
  size_t argc = 11;
  napi_value argv[11];
#endif
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      (argc != 11
#if defined(CHAT2VAULT_NATIVE_TESTING)
       && argc != 12
#endif
       ))
    return unavailable();
  auto* work = new (std::nothrow) ExclusivePublishWork();
  if (work == nullptr) return unavailable();
  work->deferred = deferred;
  void* bytes = nullptr;
  size_t length = 0;
  bool is_buffer = false;
  if (!ValidUtf16String(env, argv[0], &work->root_path) ||
      !ValidUtf16String(env, argv[1], &work->parent_path) ||
      !ValidUtf16String(env, argv[2], &work->target_name) ||
      !ValidUtf16String(env, argv[3], &work->config_path) ||
      napi_is_buffer(env, argv[4], &is_buffer) != napi_ok || !is_buffer ||
      napi_get_buffer_info(env, argv[4], &bytes, &length) != napi_ok ||
      length > 1064960 ||
      !ValidUtf16String(env, argv[5], &work->expected_root_device) ||
      !ValidUtf16String(env, argv[6], &work->expected_root_inode) ||
      !ValidUtf16String(env, argv[7], &work->expected_parent_device) ||
      !ValidUtf16String(env, argv[8], &work->expected_parent_inode) ||
      !ValidUtf16String(env, argv[9], &work->expected_config_device) ||
      !ValidUtf16String(env, argv[10], &work->expected_config_inode) ||
      work->root_path.empty() || work->root_path.front() != '/' ||
      work->target_name.empty() || work->target_name == "." ||
      work->target_name == ".." || work->target_name.find('/') != std::string::npos ||
      work->target_name.find('\\') != std::string::npos ||
      !SafeRelativePath(work->parent_path, &work->parent_parts) ||
      !SafeRelativePath(work->config_path, &work->config_parts)) {
    delete work;
    return unavailable();
  }
#if defined(CHAT2VAULT_NATIVE_TESTING)
  if (argc == 12 && !ValidUtf16String(env, argv[11], &work->test_fault)) {
    delete work;
    return unavailable();
  }
#endif
  try {
    const auto* begin = static_cast<const uint8_t*>(bytes);
    work->bytes.assign(begin, begin + length);
  } catch (...) {
    delete work;
    return unavailable();
  }
  napi_value resource_name = String(env, "Chat2Vault exclusive vault publish");
  if (napi_create_async_work(env, nullptr, resource_name, ExecuteExclusivePublish,
                             CompleteExclusivePublish, work, &work->handle) != napi_ok) {
    delete work;
    return unavailable();
  }
  if (
#if defined(CHAT2VAULT_NATIVE_TESTING)
      work->test_fault == "queue-failure" ||
#endif
      napi_queue_async_work(env, work->handle) != napi_ok) {
    napi_delete_async_work(env, work->handle);
    delete work;
    napi_resolve_deferred(env, deferred, Kind(env, "failed"));
    return promise;
  }
  return promise;
}

#if defined(CHAT2VAULT_NATIVE_TESTING)
napi_value NativeTestBarrierState(napi_env env, napi_callback_info) {
  return Kind(env, test_barrier_state.load() == 1 ? "waiting" : "idle");
}

napi_value NativeTestReleaseBarrier(napi_env env, napi_callback_info) {
  const bool waiting = test_barrier_state.load() == 1;
  if (waiting) test_barrier_state.store(2);
  return Kind(env, waiting ? "released" : "idle");
}
#endif

struct VolumeAttributes {
  uint32_t length;
  attribute_set_t returned;
  attrreference_t mount_point;
};

napi_value ObserveMacOSMountPoint(napi_env env, napi_callback_info info) {
  std::string path;
  if (!Utf8Argument(env, info, &path)) return Kind(env, "indeterminate");
  attrlist attributes{};
  attributes.bitmapcount = ATTR_BIT_MAP_COUNT;
  attributes.reserved = 0;
  attributes.commonattr = ATTR_CMN_RETURNED_ATTRS;
  attributes.volattr = ATTR_VOL_INFO | ATTR_VOL_MOUNTPOINT;
  attributes.dirattr = 0;
  attributes.fileattr = 0;
  attributes.forkattr = 0;
  std::vector<uint8_t> buffer(64 * 1024);
  if (getattrlist(path.c_str(), &attributes, buffer.data(), buffer.size(), FSOPT_NOFOLLOW_ANY | FSOPT_REPORT_FULLSIZE) != 0)
    return Kind(env, "indeterminate");
  if (buffer.size() < sizeof(VolumeAttributes)) return Kind(env, "indeterminate");
  const auto* result = reinterpret_cast<const VolumeAttributes*>(buffer.data());
  if (result->length < sizeof(VolumeAttributes) || result->length > buffer.size()) return Kind(env, "indeterminate");
  if ((result->returned.volattr & ATTR_VOL_MOUNTPOINT) == 0) return Kind(env, "unavailable");
  const auto* reference_address = reinterpret_cast<const uint8_t*>(&result->mount_point);
  const auto* begin = buffer.data();
  const auto* end = begin + result->length;
  const int64_t reference_offset = reference_address - begin;
  const int64_t value_offset = reference_offset + result->mount_point.attr_dataoffset;
  if (value_offset < 0 || value_offset >= result->length ||
      result->mount_point.attr_length == 0 ||
      static_cast<uint64_t>(value_offset) + result->mount_point.attr_length > result->length)
    return Kind(env, "indeterminate");
  const auto* value = begin + value_offset;
  if (value[result->mount_point.attr_length - 1] != 0) return Kind(env, "indeterminate");
  const size_t mount_length = result->mount_point.attr_length - 1;
  if (!FatalUtf8(value, mount_length)) return Kind(env, "invalid-utf8");
  napi_value response = Kind(env, "mount-path");
  napi_value mount_path;
  if (napi_create_string_utf8(env, reinterpret_cast<const char*>(value), mount_length, &mount_path) != napi_ok)
    return Kind(env, "indeterminate");
  napi_set_named_property(env, response, "mountPath", mount_path);
  napi_value fatal_utf8;
  napi_get_boolean(env, true, &fatal_utf8);
  napi_set_named_property(env, response, "fatalUtf8", fatal_utf8);
  napi_value returned_volume_attributes;
  napi_create_uint32(env, result->returned.volattr, &returned_volume_attributes);
  napi_set_named_property(env, response, "returnedVolumeAttributes", returned_volume_attributes);
  napi_value attr_offset;
  napi_create_int32(env, result->mount_point.attr_dataoffset, &attr_offset);
  napi_set_named_property(env, response, "attrDataOffset", attr_offset);
  napi_value attr_length;
  napi_create_uint32(env, result->mount_point.attr_length, &attr_length);
  napi_set_named_property(env, response, "attrLength", attr_length);
  const std::string raw_hex = Hex(value, mount_length);
  napi_value raw_mount_bytes_hex;
  napi_create_string_utf8(env, raw_hex.c_str(), raw_hex.size(), &raw_mount_bytes_hex);
  napi_set_named_property(env, response, "rawMountBytesHex", raw_mount_bytes_hex);
  return response;
}
#else
napi_value ReadVaultFileBounded(napi_env env, napi_callback_info) { return Kind(env, "unavailable"); }
napi_value ObserveVaultIdentity(napi_env env, napi_callback_info) { return Kind(env, "unavailable"); }
napi_value PublishVaultFileExclusive(napi_env env, napi_callback_info) { return Kind(env, "unavailable"); }
napi_value ObserveMacOSMountPoint(napi_env env, napi_callback_info) { return Kind(env, "unavailable"); }
#endif

#if defined(_WIN32)
napi_value ObserveWindowsReparsePoint(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) return Kind(env, "indeterminate");
  size_t length = 0;
  if (napi_get_value_string_utf16(env, argv[0], nullptr, 0, &length) != napi_ok) return Kind(env, "indeterminate");
  std::vector<char16_t> path(length + 1);
  if (napi_get_value_string_utf16(env, argv[0], path.data(), path.size(), &length) != napi_ok) return Kind(env, "indeterminate");
  DWORD attributes = GetFileAttributesW(reinterpret_cast<LPCWSTR>(path.data()));
  if (attributes == INVALID_FILE_ATTRIBUTES) return Kind(env, "indeterminate");
  return Kind(env, (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ? "reparse-point" : "not-reparse-point");
}
#else
napi_value ObserveWindowsReparsePoint(napi_env env, napi_callback_info) { return Kind(env, "unavailable"); }
#endif

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
      {"observeMacOSMountPoint", nullptr, ObserveMacOSMountPoint, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"observeWindowsReparsePoint", nullptr, ObserveWindowsReparsePoint, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"readVaultFileBounded", nullptr, ReadVaultFileBounded, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"observeVaultIdentity", nullptr, ObserveVaultIdentity, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"publishVaultFileExclusive", nullptr, PublishVaultFileExclusive, nullptr, nullptr, nullptr, napi_default, nullptr},
#if defined(CHAT2VAULT_NATIVE_TESTING)
      {"nativeTestBarrierState", nullptr, NativeTestBarrierState, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"nativeTestReleaseBarrier", nullptr, NativeTestReleaseBarrier, nullptr, nullptr, nullptr, napi_default, nullptr},
#endif
  };
  napi_define_properties(env, exports,
#if defined(CHAT2VAULT_NATIVE_TESTING)
                         7,
#else
                         5,
#endif
                         descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
