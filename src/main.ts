import Webamp from "webamp";

const webamp = new Webamp({
  initialTracks: [
    {
      metaData: {
        artist: "GOAMP",
        title: "Welcome to GOAMP",
      },
      url: "",
      duration: 0,
    },
  ],
});

webamp.renderWhenReady(document.getElementById("app")!);
