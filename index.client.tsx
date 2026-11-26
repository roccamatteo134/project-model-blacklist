import type { PluginClientContext, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { BlacklistSettings } from "./client/blacklist-settings";
import { strings } from "./client/strings";

function BlacklistScreen(props: PluginScreenProps) {
  return <BlacklistSettings theme={props.theme} layout={props.layout} host={props.host} />;
}

function BlacklistItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ShieldBan"
      label="Blacklist"
      active={currentScreen?.screenId === "blacklist"}
      onPress={() => openScreen({ screenId: "blacklist" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const title = strings.message("title");
  client.addScreen({ id: "blacklist", title, Component: BlacklistScreen });
  client.addSidebarHeaderItem({ id: "blacklist", title, Component: BlacklistItem });
  client.addSettingsScreen({ id: "blacklist", title, icon: "ShieldBan", Component: BlacklistSettings });
  return () => {};
}
