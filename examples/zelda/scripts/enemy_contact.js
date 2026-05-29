// enemy_contact.js — contact damage when Area overlaps player
handlers.on_area_enter = function (ctx) {
  var otherTags = ctx.data.otherTags || [];
  if (otherTags.indexOf('player') === -1) return;
  try {
    var hp = ctx.scene.get('/player', 'hp');
    var inv = ctx.scene.get('/player', 'invincible_timer') || 0;
    if (hp && hp > 0 && inv <= 0) {
      ctx.scene.set('/player', 'hp', hp - 1);
      ctx.scene.set('/player', 'invincible_timer', 1000);
      if (hp - 1 <= 0) {
        ctx.scene.set('/player', 'hp', 0);
        ctx.scene.set('/player', 'velocity', { x: 0, y: 0 });
        ctx.emit('player_died', {});
      }
    }
  } catch (e) {}
};
