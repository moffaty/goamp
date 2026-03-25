import Webamp from "webamp";
import { setupBridge } from "./webamp/bridge";
import { setupWindowDrag, setupAutoResize } from "./webamp/window-drag";
import { getButterchurnOptions } from "./webamp/butterchurn";
import { initAnalytics, track } from "./lib/analytics";

const webamp = new Webamp({
  __initialWindowLayout: {
    main: { position: { x: 0, y: 0 } },
    equalizer: { position: { x: 0, y: 116 } },
    playlist: { position: { x: 0, y: 232 }, size: [0, 4] },
  },
  initialTracks: [
    {
      metaData: {
        artist: "GOAMP",
        title: "Press Ctrl+O to open a folder",
      },
      url: "",
      duration: 0,
    },
  ],
  __butterchurnOptions: getButterchurnOptions(),
} as any);

const container = document.getElementById("app")!;

initAnalytics();

webamp.renderWhenReady(container).then(() => {
  setupBridge(webamp);
  setupWindowDrag();
  setupAutoResize();
  track("app_launched");
});
