#include <node_api.h>

#include <cstdint>
#include <string>
#include <vector>

#if defined(__APPLE__)
#include <sys/attr.h>
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
  };
  napi_define_properties(env, exports, 2, descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
