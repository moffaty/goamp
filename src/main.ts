import Webamp from "webamp";
import { setupBridge } from "./webamp/bridge";

const webamp = new Webamp({
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
});

const container = document.getElementById("app")!;

webamp.renderWhenReady(container).then(() => {
  setupBridge(webamp);
});
