## Photo Gallery with edit tools

### chrome plugin
1. Download the repo
2. Open the chrome with developer mode enabled. "Load unpacked" -> Choose "plugin" folder.
3. It should start and automatically download all generated images in aistudio to the default (downloads) folder.

### editing tool
1. Download nodejs (i used v16.20.2)
   ```
   npm install --ignore-scripts --legacy-peer-deps
   npm start
   ```
4. for serving images i used python (you can use nodejs):
   ```bash
    cd ~/Downloads
    python3 -m http.server 8000

    ```
