// React-shell bootstrap (replaces the Phaser-only main.js boot for index.html).
// The game rules still live in src/model/*; battle frames still live in
// src/scenes/* (mounted by PhaserBattle / PhaserOnlineBattle). This file only
// mounts the React menus/popups shell.
//
// NOTE: no React StrictMode here on purpose -- its dev double-effect would
// boot and destroy a whole Phaser.Game on every battle mount.

import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing in index.html");
createRoot(root).render(<App />);
