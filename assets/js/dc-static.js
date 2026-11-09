/* BellaLuz | renderizador estático dos componentes do site.
   Lê o <template id="dc-tpl">, aplica {{lacunas}}, <sc-if> e <sc-for>
   e atualiza a página com morphdom (MIT). */
(function () {
  'use strict';
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(path, scopes) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return +path;
    if (/^(['"]).*\1$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.');
    for (var s = 0; s < scopes.length; s++) {
      var sc = scopes[s];
      if (sc && Object.prototype.hasOwnProperty.call(sc, parts[0])) {
        var v = sc[parts[0]];
        for (var i = 1; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
        return v;
      }
    }
    return undefined;
  }
  function interp(str, scopes) {
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scopes); return v == null || v === false ? '' : String(v); });
  }
  var EVT = { onclick: 'click', onchange: 'change', oninput: 'input', onsubmit: 'submit', onkeydown: 'keydown', onfocus: 'focus', onblur: 'blur' };

  function renderChildren(tplParent, scopes, out, ctx) {
    var kids = tplParent.childNodes;
    for (var k = 0; k < kids.length; k++) renderNode(kids[k], scopes, out, ctx);
  }
  function renderNode(node, scopes, out, ctx) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.nodeValue, scopes))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'sc-if') {
      var m = WHOLE.exec(node.getAttribute('value') || '');
      if (m && lookup(m[1], scopes)) renderChildren(node, scopes, out, ctx);
      return;
    }
    if (tag === 'sc-for') {
      var lm = WHOLE.exec(node.getAttribute('list') || '');
      var list = lm ? lookup(lm[1], scopes) : null;
      var as = node.getAttribute('as') || 'item';
      if (list && list.length) {
        for (var i = 0; i < list.length; i++) {
          var sc = {}; sc[as] = list[i]; sc.$index = i;
          renderChildren(node, [sc].concat(scopes), out, ctx);
        }
      }
      return;
    }
    if (tag === 'dc-import' || tag === 'helmet') return;
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.tagName)
      : document.createElement(tag);
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], name = at.name, val = at.value;
      if (name.indexOf('hint-') === 0) continue;
      var whole = WHOLE.exec(val);
      if (EVT[name.toLowerCase()]) {
        if (whole) {
          var fn = lookup(whole[1], scopes);
          if (typeof fn === 'function') {
            var id = ctx.handlers.push(fn) - 1;
            el.setAttribute('data-dc-' + EVT[name.toLowerCase()], String(id));
          }
        }
        continue;
      }
      if (whole) {
        var v = lookup(whole[1], scopes);
        if (v == null || v === false) continue;
        el.setAttribute(name, v === true ? '' : String(v));
      } else if (val.indexOf('{{') > -1) {
        el.setAttribute(name, interp(val, scopes));
      } else {
        el.setAttribute(name, val);
      }
    }
    var src = tag === 'template' ? node.content : node;
    renderChildren(src, scopes, el, ctx);
    out.appendChild(el);
  }

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch, cb) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    if (p) this.state = Object.assign({}, this.state, p);
    if (this.__schedule) this.__schedule(cb);
  };
  DCLogic.prototype.forceUpdate = function (cb) { if (this.__schedule) this.__schedule(cb); };
  window.DCLogic = DCLogic;

  function mount(Component, props, root, tpl) {
    var comp = new Component(props);
    if (!comp.state) comp.state = {};
    var ctx = { handlers: [] };
    var queued = false, cbs = [];
    function render() {
      queued = false;
      var vals = comp.renderVals ? comp.renderVals() : {};
      ctx = { handlers: [] };
      var fresh = document.createElement(root.tagName);
      renderChildren(tpl.content, [vals], fresh, ctx);
      window.morphdom(root, fresh, {
        childrenOnly: true,
        onBeforeElUpdated: function (from, to) {
          if (from === document.activeElement && (from.tagName === 'INPUT' || from.tagName === 'TEXTAREA') && from.value !== to.getAttribute('value')) {
            from.value = to.getAttribute('value') || '';
          }
          return !from.isEqualNode(to);
        }
      });
      var run = cbs; cbs = [];
      run.forEach(function (f) { try { f(); } catch (e) {} });
    }
    comp.__schedule = function (cb) {
      if (cb) cbs.push(cb);
      if (!queued) { queued = true; Promise.resolve().then(render); }
    };
    function fire(type, e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-dc-' + type + ']') : null;
      if (!t || !root.contains(t)) return;
      var fn = ctx.handlers[+t.getAttribute('data-dc-' + type)];
      if (typeof fn === 'function') fn(e);
    }
    function isTexty(el) {
      return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|file|range|color|submit|button)$/i.test(el.type)));
    }
    root.addEventListener('click', function (e) { fire('click', e); });
    root.addEventListener('input', function (e) { fire('input', e); if (isTexty(e.target)) fire('change', e); });
    root.addEventListener('change', function (e) { if (!isTexty(e.target)) fire('change', e); });
    root.addEventListener('submit', function (e) { fire('submit', e); });
    root.addEventListener('keydown', function (e) { fire('keydown', e); });
    render();
    if (comp.componentDidMount) { try { comp.componentDidMount(); } catch (e) { console.error(e); } }
    window.addEventListener('pagehide', function () { if (comp.componentWillUnmount) try { comp.componentWillUnmount(); } catch (e) {} });
    return comp;
  }
  window.DCStatic = { mount: mount };
})();
