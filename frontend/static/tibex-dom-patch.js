/* TIBEX DOM patch — real-time yangilanishda pirpirash bo'lmasin.
 *
 * innerHTML = ... butun jadvalni o'chirib qayta yaratadi (miltillash, hover/scroll/fokus yo'qolishi).
 * Bu yerda esa yangi HTML mavjud DOM bilan solishtiriladi va FAQAT o'zgargan
 * matn / atribut / qatorlar yangilanadi. Qolgan tugunlar tegilmaydi.
 *
 *   TIBEX_PATCH.html(element, htmlString)  — bolalarni farq bo'yicha yangilaydi
 *   TIBEX_PATCH.text(element, value)       — matn o'zgargan bo'lsagina yozadi
 *
 * Qatorlar data-key | data-id | data-appt-id bo'yicha taqqoslanadi (tartib o'zgarsa, tugun ko'chiriladi).
 */
(function () {
  "use strict";
  if (window.TIBEX_PATCH) return;

  function keyOf(n) {
    if (n.nodeType !== 1) return null;
    return n.getAttribute("data-key") || n.getAttribute("data-id") || n.getAttribute("data-appt-id") || null;
  }

  function sameKind(a, b) {
    return a.nodeType === b.nodeType && (a.nodeType !== 1 || a.nodeName === b.nodeName);
  }

  function syncAttrs(from, to) {
    var i, a;
    var fa = from.attributes;
    for (i = fa.length - 1; i >= 0; i--) {
      a = fa[i];
      if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
    }
    var ta = to.attributes;
    for (i = 0; i < ta.length; i++) {
      a = ta[i];
      if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    }
  }

  function syncControl(from, to) {
    // Foydalanuvchi yozayotgan maydonga tegilmaydi
    if (from === document.activeElement) return;
    var tag = from.nodeName;
    if (tag === "INPUT") {
      if (from.type === "checkbox" || from.type === "radio") {
        var c = to.hasAttribute("checked");
        if (from.checked !== c) from.checked = c;
      } else if (to.hasAttribute("value") && from.value !== to.getAttribute("value")) {
        from.value = to.getAttribute("value");
      }
    }
  }

  function morphNode(from, to) {
    if (from.nodeType !== 1) {
      if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
      return;
    }
    syncAttrs(from, to);
    syncControl(from, to);
    morphChildren(from, to);
  }

  function morphChildren(oldParent, newParent) {
    var newNodes = Array.prototype.slice.call(newParent.childNodes);
    var keyed = new Map();
    var unkeyed = [];
    var c;
    for (c = oldParent.firstChild; c; c = c.nextSibling) {
      var k0 = keyOf(c);
      if (k0 != null) { if (!keyed.has(k0)) keyed.set(k0, c); }
      else unkeyed.push(c);
    }

    var result = [];
    var u = 0;
    for (var i = 0; i < newNodes.length; i++) {
      var nn = newNodes[i];
      var k = keyOf(nn);
      var match = null;
      if (k != null) {
        match = keyed.get(k) || null;
        if (match) { keyed.delete(k); if (!sameKind(match, nn)) match = null; }
      } else {
        var cand = unkeyed[u];
        if (cand && sameKind(cand, nn)) { match = cand; u++; }
      }
      if (match) { morphNode(match, nn); result.push(match); }
      else result.push(nn);
    }

    // DOM tartibini moslash: faqat kerak bo'lgan tugunlar ko'chiriladi/qo'shiladi
    var ref = oldParent.firstChild;
    for (var j = 0; j < result.length; j++) {
      var node = result[j];
      if (node === ref) ref = ref.nextSibling;
      else oldParent.insertBefore(node, ref);
    }
    while (ref) {
      var nx = ref.nextSibling;
      oldParent.removeChild(ref);
      ref = nx;
    }
  }

  window.TIBEX_PATCH = {
    html: function (el, html) {
      if (!el) return;
      var t = document.createElement("template");
      t.innerHTML = html == null ? "" : String(html);
      morphChildren(el, t.content);
    },
    text: function (el, value) {
      if (!el) return;
      var v = value == null ? "" : String(value);
      if (el.textContent !== v) el.textContent = v;
    }
  };
})();
