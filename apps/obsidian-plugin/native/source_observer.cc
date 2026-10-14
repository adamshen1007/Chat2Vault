#include <node_api.h>

#include <cstdint>
#include <cmath>
#include <new>
#include <string>
#include <vector>

#if defined(__APPLE__)
#include <sys/attr.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <cerrno>
#include <unistd.h>
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
  size_t argc = 3;
  napi_value argv[3];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 3) return unavailable();
  auto* work = new (std::nothrow) BoundedReadWork();
  if (work == nullptr) return unavailable();
  work->deferred = deferred;
  double max_double = -1;
  napi_valuetype max_type;
  if (!ValidUtf16String(env, argv[0], &work->root_path) ||
      !ValidUtf16String(env, argv[1], &work->relative_path) ||
      napi_typeof(env, argv[2], &max_type) != napi_ok || max_type != napi_number ||
      napi_get_value_double(env, argv[2], &max_double) != napi_ok ||
      !std::isfinite(max_double) || max_double < 0 || max_double > 128 * 1024 ||
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
  if (napi_queue_async_work(env, work->handle) != napi_ok) {
    napi_delete_async_work(env, work->handle);
    delete work;
    return unavailable();
  }
  return promise;
}

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
  };
  napi_define_properties(env, exports, 3, descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
