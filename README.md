# MixDesk: Poseidon Showcase

A ten-channel browser mixing desk. Static HTML, CSS and JavaScript, deployed with GitHub Pages.

## Features
- Faders, mute, solo, pan and stereo level meters on every channel
- Master fader with stereo meters and a clip light
- Seek bar, time display and loop
- Rename channels and change their colours
- Scenes A to C to store and recall mixes
- Copy a link that carries your whole mix
- Reset mix with undo
- Your mix is remembered between visits
- Keyboard shortcuts (press `?` on the page)

## Run locally
Browsers block audio from `file://` pages, so serve the folder:

    python3 -m http.server 8000

Then open http://localhost:8000.

## Audio
Put your tracks in `audio/` as `channel-1.mp3` to `channel-10.mp3`.
