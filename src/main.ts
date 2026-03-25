import Webamp from "webamp";
import { setupBridge } from "./webamp/bridge";
import { setupWindowDrag, setupFullscreenCanvas } from "./webamp/window-drag";

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
} as any);

const container = document.getElementById("app")!;

webamp.renderWhenReady(container).then(() => {
  setupBridge(webamp);
  setupWindowDrag();
  setupFullscreenCanvas();
});
