#include <node_api.h>

#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>

#include <cstdint>
#include <string>
#include <vector>

namespace {

napi_value String(napi_env env, const char* value) {
  napi_value result;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value Boolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

napi_value Object(napi_env env) {
  napi_value result;
  napi_create_object(env, &result);
  return result;
}

void Set(napi_env env, napi_value object, const char* key, napi_value value) {
  napi_set_named_property(env, object, key, value);
}

napi_value Status(napi_env env, const char* tag) {
  napi_value result = Object(env);
  Set(env, result, "tag", String(env, tag));
  return result;
}

napi_value Configured(napi_env env, const std::string& secret) {
  napi_value result = Status(env, "configured");
  napi_value value;
  napi_create_string_utf8(env, secret.data(), secret.size(), &value);
  Set(env, result, "secret", value);
  return result;
}

napi_value Success(napi_env env, const char* state, const char* effect) {
  napi_value result = Status(env, "success");
  Set(env, result, "state", String(env, state));
  Set(env, result, "effect", String(env, effect));
  return result;
}

napi_value Failed(napi_env env, const char* stage, bool may_have_changed) {
  napi_value result = Status(env, "failed");
  Set(env, result, "state", String(env, "unknown"));
  Set(env, result, "stage", String(env, stage));
  Set(env, result, "mayHaveChanged", Boolean(env, may_have_changed));
  return result;
}

bool Utf8Argument(napi_env env, napi_value value, std::string* output) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return false;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
  std::vector<char> bytes(length + 1);
  if (napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &length) != napi_ok) return false;
  output->assign(bytes.data(), length);
  return output->find('\0') == std::string::npos;
}

bool Arguments(napi_env env, napi_callback_info info, size_t expected,
               std::vector<std::string>* output) {
  std::vector<napi_value> argv(expected);
  size_t argc = expected;
  if (napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr) != napi_ok || argc != expected)
    return false;
  output->clear();
  output->reserve(expected);
  for (const auto value : argv) {
    std::string argument;
    if (!Utf8Argument(env, value, &argument)) return false;
    output->push_back(std::move(argument));
  }
  return true;
}

bool VisibleAsciiSecret(const std::string& secret) {
  if (secret.empty() || secret.size() > 4096) return false;
  for (const unsigned char byte : secret)
    if (byte < 0x21 || byte > 0x7e) return false;
  return true;
}

CFStringRef Utf8String(const std::string& value) {
  return CFStringCreateWithBytes(kCFAllocatorDefault,
                                 reinterpret_cast<const UInt8*>(value.data()),
                                 static_cast<CFIndex>(value.size()),
                                 kCFStringEncodingUTF8, false);
}

CFDataRef Bytes(const std::string& value) {
  return CFDataCreate(kCFAllocatorDefault,
                      reinterpret_cast<const UInt8*>(value.data()),
                      static_cast<CFIndex>(value.size()));
}

struct DefaultKeychain {
  SecKeychainRef keychain = nullptr;
  CFArrayRef search_list = nullptr;

  ~DefaultKeychain() {
    if (search_list != nullptr) CFRelease(search_list);
    if (keychain != nullptr) CFRelease(keychain);
  }
};

bool ResolveDefaultKeychain(DefaultKeychain* context) {
  if (SecKeychainCopyDefault(&context->keychain) != errSecSuccess ||
      context->keychain == nullptr)
    return false;
  const void* values[] = {context->keychain};
  context->search_list = CFArrayCreate(kCFAllocatorDefault, values, 1,
                                       &kCFTypeArrayCallBacks);
  return context->search_list != nullptr;
}

CFMutableDictionaryRef BaseQuery(const std::string& service,
                                 const std::string& account) {
  CFStringRef service_value = Utf8String(service);
  CFStringRef account_value = Utf8String(account);
  if (service_value == nullptr || account_value == nullptr) {
    if (service_value != nullptr) CFRelease(service_value);
    if (account_value != nullptr) CFRelease(account_value);
    return nullptr;
  }
  CFMutableDictionaryRef query = CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
                                                            &kCFTypeDictionaryKeyCallBacks,
                                                            &kCFTypeDictionaryValueCallBacks);
  if (query != nullptr) {
    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, service_value);
    CFDictionarySetValue(query, kSecAttrAccount, account_value);
  }
  CFRelease(service_value);
  CFRelease(account_value);
  return query;
}

CFMutableDictionaryRef SearchQuery(const std::string& service,
                                   const std::string& account,
                                   const DefaultKeychain& context) {
  CFMutableDictionaryRef query = BaseQuery(service, account);
  if (query != nullptr)
    CFDictionarySetValue(query, kSecMatchSearchList, context.search_list);
  return query;
}

CFMutableDictionaryRef AddQuery(const std::string& service,
                                const std::string& account,
                                const DefaultKeychain& context) {
  CFMutableDictionaryRef query = BaseQuery(service, account);
  if (query != nullptr)
    CFDictionarySetValue(query, kSecUseKeychain, context.keychain);
  return query;
}

enum class Presence { kConfigured, kMissing, kUnavailable };

Presence CopyPresence(CFDictionaryRef query) {
  CFTypeRef ignored = nullptr;
  const OSStatus status = SecItemCopyMatching(query, &ignored);
  if (ignored != nullptr) CFRelease(ignored);
  if (status == errSecSuccess) return Presence::kConfigured;
  if (status == errSecItemNotFound) return Presence::kMissing;
  return Presence::kUnavailable;
}

bool EqualBytes(CFDataRef data, const std::string& expected) {
  if (data == nullptr || CFDataGetLength(data) != static_cast<CFIndex>(expected.size())) return false;
  const UInt8* actual = CFDataGetBytePtr(data);
  uint8_t difference = 0;
  for (size_t index = 0; index < expected.size(); ++index)
    difference |= actual[index] ^ static_cast<uint8_t>(expected[index]);
  return difference == 0;
}

Presence Read(CFMutableDictionaryRef query, std::string* secret) {
  CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
  CFTypeRef result = nullptr;
  const OSStatus status = SecItemCopyMatching(query, &result);
  if (status == errSecItemNotFound) return Presence::kMissing;
  if (status != errSecSuccess || result == nullptr || CFGetTypeID(result) != CFDataGetTypeID()) {
    if (result != nullptr) CFRelease(result);
    return Presence::kUnavailable;
  }
  const CFDataRef data = static_cast<CFDataRef>(result);
  const auto length = static_cast<size_t>(CFDataGetLength(data));
  secret->assign(reinterpret_cast<const char*>(CFDataGetBytePtr(data)), length);
  CFRelease(result);
  return Presence::kConfigured;
}

napi_value CredentialStatus(napi_env env, napi_callback_info info) {
  std::vector<std::string> args;
  if (!Arguments(env, info, 2, &args)) return Status(env, "unavailable");
  DefaultKeychain context;
  if (!ResolveDefaultKeychain(&context)) return Status(env, "unavailable");
  CFMutableDictionaryRef query = SearchQuery(args[0], args[1], context);
  if (query == nullptr) return Status(env, "unavailable");
  const Presence presence = CopyPresence(query);  // Status query intentionally omits kSecReturnData.
  CFRelease(query);
  return Status(env, presence == Presence::kConfigured ? "configured" :
                     presence == Presence::kMissing ? "missing" : "unavailable");
}

napi_value ReadCredential(napi_env env, napi_callback_info info) {
  std::vector<std::string> args;
  if (!Arguments(env, info, 2, &args)) return Status(env, "unavailable");
  DefaultKeychain context;
  if (!ResolveDefaultKeychain(&context)) return Status(env, "unavailable");
  CFMutableDictionaryRef query = SearchQuery(args[0], args[1], context);
  if (query == nullptr) return Status(env, "unavailable");
  std::string secret;
  const Presence presence = Read(query, &secret);  // Provider-operation data read.
  CFRelease(query);
  if (presence == Presence::kConfigured) return Configured(env, secret);
  return Status(env, presence == Presence::kMissing ? "missing" : "unavailable");
}

napi_value SetCredential(napi_env env, napi_callback_info info) {
  std::vector<std::string> args;
  if (!Arguments(env, info, 3, &args) || !VisibleAsciiSecret(args[2]))
    return Failed(env, "mutation", false);
  DefaultKeychain context;
  if (!ResolveDefaultKeychain(&context)) return Failed(env, "mutation", false);
  CFMutableDictionaryRef selector = SearchQuery(args[0], args[1], context);
  if (selector == nullptr) return Failed(env, "mutation", false);
  const Presence before = CopyPresence(selector);
  if (before == Presence::kUnavailable) {
    CFRelease(selector);
    return Failed(env, "mutation", false);
  }
  CFDataRef data = Bytes(args[2]);
  if (data == nullptr) {
    CFRelease(selector);
    return Failed(env, "mutation", false);
  }
  OSStatus status;
  if (before == Presence::kMissing) {
    CFMutableDictionaryRef addition = AddQuery(args[0], args[1], context);
    if (addition == nullptr) status = errSecAllocate;
    else {
      CFDictionarySetValue(addition, kSecValueData, data);
      status = SecItemAdd(addition, nullptr);
      CFRelease(addition);
    }
  } else {
    CFMutableDictionaryRef attributes = CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
                                                                   &kCFTypeDictionaryKeyCallBacks,
                                                                   &kCFTypeDictionaryValueCallBacks);
    if (attributes == nullptr) status = errSecAllocate;
    else {
      CFDictionarySetValue(attributes, kSecValueData, data);
      status = SecItemUpdate(selector, attributes);
      CFRelease(attributes);
    }
  }
  CFRelease(data);
  CFRelease(selector);
  if (status != errSecSuccess) return Failed(env, "mutation", false);

  CFMutableDictionaryRef verification = SearchQuery(args[0], args[1], context);
  if (verification == nullptr) return Failed(env, "verification", true);
  CFDictionarySetValue(verification, kSecReturnData, kCFBooleanTrue);
  CFTypeRef found = nullptr;
  const OSStatus verification_status = SecItemCopyMatching(verification, &found);
  const bool matches = verification_status == errSecSuccess && found != nullptr &&
                       CFGetTypeID(found) == CFDataGetTypeID() &&
                       EqualBytes(static_cast<CFDataRef>(found), args[2]);
  if (found != nullptr) CFRelease(found);
  CFRelease(verification);
  if (!matches) return Failed(env, "verification", true);
  return Success(env, "configured", before == Presence::kMissing ? "created" : "replaced");
}

napi_value DeleteCredential(napi_env env, napi_callback_info info) {
  std::vector<std::string> args;
  if (!Arguments(env, info, 2, &args)) return Failed(env, "mutation", false);
  DefaultKeychain context;
  if (!ResolveDefaultKeychain(&context)) return Failed(env, "mutation", false);
  CFMutableDictionaryRef selector = SearchQuery(args[0], args[1], context);
  if (selector == nullptr) return Failed(env, "mutation", false);
  const OSStatus status = SecItemDelete(selector);
  CFRelease(selector);
  if (status != errSecSuccess && status != errSecItemNotFound)
    return Failed(env, "mutation", false);
  CFMutableDictionaryRef verification = SearchQuery(args[0], args[1], context);
  if (verification == nullptr) return Failed(env, "verification", true);
  const Presence absence = CopyPresence(verification);  // Absence verification never requests data.
  CFRelease(verification);
  if (absence != Presence::kMissing) return Failed(env, "verification", true);
  return Success(env, "missing", status == errSecItemNotFound ? "already-missing" : "deleted");
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_value abi_version;
  napi_create_uint32(env, 1, &abi_version);
  napi_set_named_property(env, exports, "abiVersion", abi_version);
  napi_property_descriptor descriptors[] = {
      {"credentialStatus", nullptr, CredentialStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"readCredential", nullptr, ReadCredential, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setCredential", nullptr, SetCredential, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"deleteCredential", nullptr, DeleteCredential, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 4, descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
