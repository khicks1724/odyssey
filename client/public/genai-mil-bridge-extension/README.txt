Odyssey GenAI.mil Browser Bridge
================================

This extension lets Odyssey call https://api.genai.mil from this workstation.
The request therefore uses the workstation's DoW network and browser proxy
configuration instead of the Odyssey AWS server.

Chrome / Edge installation
--------------------------

1. Unzip this download to a permanent folder.
2. Open chrome://extensions or edge://extensions.
3. Enable Developer mode.
4. Choose Load unpacked and select the unzipped folder containing manifest.json.
5. Reload https://asterias.ssag.nps.edu/odyssey/.
6. In Odyssey Settings -> AI Providers, enter the STARK key and click Test.

Security
--------

- The extension can contact only api.genai.mil.
- It accepts requests only from the Odyssey production page or local Odyssey
  development page.
- It does not store the STARK key. Odyssey passes the tab-session browser copy
  to the extension only when making a GenAI.mil request.
