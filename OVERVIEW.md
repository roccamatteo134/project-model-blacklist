Block models per Paseo project.

Define a blacklist for each project with exact provider or provider/model entries, optional regex on provider and model, and protected folder paths. New agents with a blacklisted model fail to create in that project, and resume of existing agents with that model fails on open.

For cross project access, the plugin injects provider native folder denies on creation. OpenCode gets read, edit, glob, grep and list denies for protected paths. Claude gets denyRead entries. Codex is forced to workspace write rooted at the agent directory. Open sessions also receive a system prompt that forbids the protected folders.

Setup: open Settings, Plugins, Project blacklist and add one rule per projectId. Find the projectId with the workspace list, or rely on path match by listing the project folder in paths. Requires Paseo 0.17.5 or later. All data stays on the daemon host.

Limits: file denies are provider native sandboxes, not OS isolation. Bash escapes and already running turns are best effort. Terminals have no model and are not blocked.
