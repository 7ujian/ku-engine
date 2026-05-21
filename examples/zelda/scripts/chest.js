// chest.js — Chest interaction (E key handled in player.js)
// This script handles visual feedback for chest opening
var opened = false;

handlers.on_enter = function (ctx) {
  opened = false;
};
