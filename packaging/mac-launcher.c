#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  char executable[PATH_MAX], resolved[PATH_MAX], runtime[PATH_MAX], entry[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) || !realpath(executable, resolved)) return 1;
  char *slash = strrchr(resolved, '/');
  if (!slash) return 1;
  *slash = 0;
#if defined(__arm64__)
  const char *arch = "arm64";
#else
  const char *arch = "x64";
#endif
  if (snprintf(runtime, sizeof(runtime), "%s/../Resources/runtime-%s/node", resolved, arch) >= sizeof(runtime)) return 1;
  if (snprintf(entry, sizeof(entry), "%s/../Resources/app/src/portable.mjs", resolved) >= sizeof(entry)) return 1;
  char **args = calloc((size_t)argc + 2, sizeof(char *));
  if (!args) return 1;
  args[0] = runtime; args[1] = entry;
  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
  execv(runtime, args);
  perror("HWP diff launcher");
  free(args);
  return 1;
}
