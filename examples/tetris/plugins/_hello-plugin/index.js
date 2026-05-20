export const plugin = {
  name: 'hello-plugin',
  version: '1.0.0',

  init(host) {
    host.registerNodeType('HelloPlugin', (id, overrides) => {
      return host.createNode(id, 'HelloPlugin', { message: 'hello plugin!' }, overrides);
    });

    host.registerNodeRenderer('HelloPlugin', (ctx, node, wx, wy) => {
      const msg = node.getProperty('message') || 'hello plugin!';
      ctx.save();
      ctx.fillStyle = '#00ff00';
      ctx.font = '16px monospace';
      ctx.fillText(msg, wx, wy);
      ctx.restore();
    });

    host.registerAction('hello', (node, action, context, event, eng) => {
      const msg = node.getProperty('message') || 'hello plugin!';
      eng.recordError(node.id, event, 'hello', msg);
    });
  }
};
