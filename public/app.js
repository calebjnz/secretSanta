(function () {
  'use strict';

  // ---------- State ----------
  var currentUser = null;
  var app = document.getElementById('app');

  // ---------- DOM helper (never uses innerHTML with data) ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  function mount(node) {
    app.textContent = '';
    append(app, node);
  }

  // ---------- Formatting ----------
  var gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  function formatCost(c) {
    return (c === null || c === undefined || c === '' || isNaN(Number(c))) ? null : gbp.format(Number(c));
  }
  function isSafeUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u.trim());
  }

  // ---------- API ----------
  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = {};
        try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = {}; }
        if (res.status === 401 && !/\/api\/auth\/(login|register|me)$/.test(path)) {
          currentUser = null;
          updateNav();
          go('#/login');
        }
        if (!res.ok) {
          var err = new Error(data.error || ('Request failed (' + res.status + ')'));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------- UI helpers ----------
  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }
  function errorBox() {
    var box = h('div', { class: 'error', role: 'alert' });
    box.hidden = true;
    box.show = function (msg) { box.textContent = msg; box.hidden = !msg; };
    return box;
  }
  function loading() { return h('p', { class: 'loading', text: 'Loading…' }); }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      ta.remove();
    });
  }
  function copyButton(text, label) {
    return h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: function () {
        copyText(text).then(function () { toast('Copied ' + text); }, function () { toast('Could not copy'); });
      }
    }, label || 'Copy');
  }

  // ---------- Modal ----------
  var modalRoot = document.getElementById('modal-root');
  function openModal(title, body) {
    document.getElementById('modal-title').textContent = title;
    var mb = document.getElementById('modal-body');
    mb.textContent = '';
    append(mb, body);
    modalRoot.hidden = false;
    var first = mb.querySelector('input, button');
    if (first) first.focus();
  }
  function closeModal() { modalRoot.hidden = true; }
  modalRoot.addEventListener('click', function (e) {
    if (e.target === modalRoot || e.target.hasAttribute('data-close')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modalRoot.hidden) closeModal();
  });

  // ---------- Nav ----------
  function updateNav() {
    var nav = document.getElementById('nav');
    nav.hidden = !currentUser;
    document.getElementById('nav-user').textContent = currentUser ? currentUser.name : '';
    var r = (location.hash.split('/')[1] || '');
    Array.prototype.forEach.call(nav.querySelectorAll('a[data-route]'), function (a) {
      var active = a.getAttribute('data-route') === r || (r === 'family' && a.getAttribute('data-route') === 'families');
      a.classList.toggle('active', active);
    });
  }
  document.getElementById('logout-btn').addEventListener('click', function () {
    api('POST', '/api/auth/logout').catch(function () {}).then(function () {
      currentUser = null;
      updateNav();
      go('#/login');
    });
  });

  // ---------- Present rendering ----------
  function presentItem(p, opts) {
    opts = opts || {};
    var cost = formatCost(p.cost);
    var meta = h('div', { class: 'present-meta' },
      cost ? h('span', { class: 'cost', text: cost }) : null,
      isSafeUrl(p.link) ? h('a', { href: p.link.trim(), target: '_blank', rel: 'noopener noreferrer', text: 'View link ↗' }) : null,
      opts.showSuggester && p.suggestedBy ? h('span', { text: 'Suggested by ' + p.suggestedBy.name }) : null
    );
    return h('li', null,
      h('div', { class: 'grow' }, h('div', { class: 'present-name', text: p.itemName }), meta),
      opts.actions || null
    );
  }
  function presentList(items, emptyText, opts) {
    if (!items || !items.length) return h('p', { class: 'empty', text: emptyText });
    return h('ul', { class: 'list' }, items.map(function (p) { return presentItem(p, opts); }));
  }

  // Shared add/edit form for presents
  function presentForm(opts) {
    var init = opts.initial || {};
    var err = errorBox();
    var name = h('input', { type: 'text', required: true, maxlength: 200, placeholder: 'e.g. Cosy wool socks' });
    var link = h('input', { type: 'url', placeholder: 'https://…' });
    var cost = h('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', placeholder: '0.00' });
    name.value = init.itemName || '';
    link.value = init.link || '';
    cost.value = (init.cost === null || init.cost === undefined) ? '' : init.cost;
    var uid = Math.random().toString(36).slice(2, 8);
    name.id = 'n' + uid; link.id = 'l' + uid; cost.id = 'c' + uid;
    var submit = h('button', { class: 'btn ' + (opts.buttonClass || ''), type: 'submit' }, opts.submitLabel || 'Save');

    var form = h('form', { novalidate: true },
      err,
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: name.id }, 'Item name'), name),
        h('div', { class: 'field' }, h('label', { for: link.id }, 'Link ', h('span', { class: 'opt', text: '(optional)' })), link),
        h('div', { class: 'field' }, h('label', { for: cost.id }, 'Cost £ ', h('span', { class: 'opt', text: '(optional)' })), cost)
      ),
      h('div', { class: 'row' }, submit, opts.extraButtons || null)
    );
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.show('');
      var itemName = name.value.trim();
      var linkVal = link.value.trim();
      var costVal = cost.value.trim();
      if (!itemName) { err.show('Please enter an item name.'); name.focus(); return; }
      if (linkVal && !isSafeUrl(linkVal)) { err.show('Link must start with http:// or https://'); link.focus(); return; }
      if (costVal && (isNaN(Number(costVal)) || Number(costVal) < 0)) { err.show('Cost must be a positive number.'); cost.focus(); return; }
      var payload = { itemName: itemName };
      if (linkVal) payload.link = linkVal; else if (opts.sendNulls) payload.link = null;
      if (costVal) payload.cost = Number(costVal); else if (opts.sendNulls) payload.cost = null;
      submit.disabled = true;
      Promise.resolve(opts.onSubmit(payload)).then(function () {
        if (opts.resetOnSuccess) form.reset();
      }, function (ex) { err.show(ex.message); }).then(function () { submit.disabled = false; });
    });
    return form;
  }

  // ---------- Views: auth ----------
  function authView(isRegister) {
    var err = errorBox();
    var fields = [];
    var nameIn = h('input', { type: 'text', id: 'f-name', autocomplete: 'name', required: true });
    var emailIn = h('input', { type: 'email', id: 'f-email', autocomplete: 'email', required: true });
    var passIn = h('input', { type: 'password', id: 'f-pass', autocomplete: isRegister ? 'new-password' : 'current-password', required: true });
    if (isRegister) fields.push(h('div', { class: 'field' }, h('label', { for: 'f-name' }, 'Your name'), nameIn));
    fields.push(h('div', { class: 'field' }, h('label', { for: 'f-email' }, 'Email'), emailIn));
    fields.push(h('div', { class: 'field' }, h('label', { for: 'f-pass' }, 'Password'), passIn));
    var submit = h('button', { class: 'btn btn-block', type: 'submit' }, isRegister ? 'Create account' : 'Log in');

    var form = h('form', null, err, fields, submit);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.show('');
      var body = { email: emailIn.value.trim(), password: passIn.value };
      if (isRegister) body.name = nameIn.value.trim();
      if ((isRegister && !body.name) || !body.email || !body.password) { err.show('Please fill in all fields.'); return; }
      submit.disabled = true;
      api('POST', isRegister ? '/api/auth/register' : '/api/auth/login', body).then(function (d) {
        currentUser = d.user;
        updateNav();
        go('#/families');
      }, function (ex) {
        err.show(ex.message);
        submit.disabled = false;
      });
    });

    mount(h('div', { class: 'card card-narrow' },
      h('div', { class: 'eyebrow', text: isRegister ? 'Join the fun' : 'Welcome back' }),
      h('h1', { text: isRegister ? 'Create an account' : 'Log in' }),
      form,
      h('p', { class: 'center small muted', style: 'margin-top:14px' },
        isRegister ? 'Already have an account? ' : 'New here? ',
        h('a', { href: isRegister ? '#/login' : '#/register', text: isRegister ? 'Log in' : 'Create an account' }))
    ));
    (isRegister ? nameIn : emailIn).focus();
  }

  // ---------- Views: families ----------
  function familiesView() {
    var listCard = h('div', { class: 'card' }, loading());
    mount([
      h('div', { class: 'page-head' },
        h('h1', { text: 'My Families' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: openCreateModal }, '+ Create family'),
          h('button', { class: 'btn btn-red', type: 'button', onclick: openJoinModal }, 'Join family'))
      ),
      listCard
    ]);
    api('GET', '/api/families').then(function (d) {
      listCard.textContent = '';
      if (!d.families.length) {
        append(listCard, h('p', { class: 'empty', text: 'You are not in any families yet. Create one and share the code, or join with a code someone sent you.' }));
        return;
      }
      append(listCard, h('ul', { class: 'list' }, d.families.map(function (f) {
        return h('li', null,
          h('div', { class: 'grow' },
            h('a', { class: 'family-link', href: '#/family/' + encodeURIComponent(f.id), text: f.name }),
            h('div', { class: 'meta', text: f.memberCount + (f.memberCount === 1 ? ' member' : ' members') })),
          h('span', { class: 'code-badge', text: f.code })
        );
      })));
    }, function (ex) { listCard.textContent = ''; append(listCard, h('p', { class: 'error', text: ex.message })); });
  }

  function openCreateModal() {
    var err = errorBox();
    var input = h('input', { type: 'text', id: 'm-fname', maxlength: 100, required: true, placeholder: 'e.g. The Smiths' });
    var submit = h('button', { class: 'btn btn-block', type: 'submit' }, 'Create family');
    var form = h('form', null, err, h('div', { class: 'field' }, h('label', { for: 'm-fname' }, 'Family name'), input), submit);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = input.value.trim();
      if (!name) { err.show('Please enter a family name.'); return; }
      submit.disabled = true;
      api('POST', '/api/families', { name: name }).then(function (d) {
        var f = d.family;
        openModal('Family created!', [
          h('p', null, 'Share this code with your family so they can join ', h('strong', { text: f.name }), ':'),
          h('span', { class: 'code-big', text: f.code }),
          h('div', { class: 'row' },
            copyButton(f.code, 'Copy code'),
            h('button', { class: 'btn', type: 'button', onclick: function () { closeModal(); go('#/family/' + encodeURIComponent(f.id)); } }, 'Go to family page'))
        ]);
      }, function (ex) { err.show(ex.message); submit.disabled = false; });
    });
    openModal('Create a family', form);
  }

  function openJoinModal() {
    var err = errorBox();
    var input = h('input', { type: 'text', id: 'm-code', class: 'code-input', maxlength: 6, autocomplete: 'off', required: true, placeholder: 'ABC123' });
    var submit = h('button', { class: 'btn btn-red btn-block', type: 'submit' }, 'Join family');
    var form = h('form', null, err, h('div', { class: 'field' }, h('label', { for: 'm-code' }, 'Family code'), input), submit);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = input.value.trim().toUpperCase();
      if (!code) { err.show('Please enter a family code.'); return; }
      submit.disabled = true;
      api('POST', '/api/families/join', { code: code }).then(function (d) {
        closeModal();
        toast('Joined ' + d.family.name);
        go('#/family/' + encodeURIComponent(d.family.id));
      }, function (ex) { err.show(ex.message); submit.disabled = false; });
    });
    openModal('Join a family', form);
  }

  // ---------- Views: single family ----------
  function familyView(id) {
    mount(loading());
    var base = '/api/families/' + encodeURIComponent(id);
    api('GET', base).then(function (d) {
      var f = d.family;
      var others = f.members.filter(function (m) { return m.id !== currentUser.id; });

      var assignmentCard = null;
      if (f.allocated) {
        assignmentCard = h('div', { class: 'card card-highlight' }, loading());
        api('GET', base + '/assignment').then(function (a) {
          assignmentCard.textContent = '';
          if (!a.recipient) { append(assignmentCard, h('p', { class: 'empty', text: 'No assignment found yet.' })); return; }
          append(assignmentCard, [
            h('div', { class: 'eyebrow', text: '★ Your Secret Santa assignment' }),
            h('h2', null, 'You are buying for: ', h('span', { style: 'color:var(--red)', text: a.recipient.name })),
            h('p', { class: 'small muted', text: 'Keep it secret! Here is their present profile.' }),
            h('h3', { class: 'section-title', text: a.recipient.name + '’s own ideas' }),
            presentList(a.ideas, 'They haven’t added any ideas yet.'),
            h('h3', { class: 'section-title', text: 'Secret suggestions from the family' }),
            presentList(a.suggestions, 'No suggestions yet.', { showSuggester: true })
          ]);
        }, function (ex) { assignmentCard.textContent = ''; append(assignmentCard, h('p', { class: 'error', text: ex.message })); });
      }

      // Members
      var memberList = h('ul', { class: 'list' }, f.members.map(function (m) {
        var isMe = m.id === currentUser.id;
        var li = h('li', null,
          h('div', { class: 'grow' }, h('span', { class: 'present-name', text: m.name }), ' ', isMe ? h('span', { class: 'pill', text: 'You' }) : null)
        );
        if (!isMe) {
          var panel = null;
          var btn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-expanded': 'false' }, 'Ideas & suggestions');
          btn.addEventListener('click', function () {
            if (panel) { panel.remove(); panel = null; btn.setAttribute('aria-expanded', 'false'); btn.textContent = 'Ideas & suggestions'; return; }
            panel = memberPanel(base, m);
            li.appendChild(panel);
            btn.setAttribute('aria-expanded', 'true');
            btn.textContent = 'Hide';
          });
          li.appendChild(btn);
        }
        return li;
      }));

      // Arrange
      var enough = f.members.length >= 2;
      var arrangeBtn = h('button', { class: 'btn btn-red', type: 'button', disabled: !enough }, f.allocated ? 'Re-arrange Secret Santa' : 'Arrange Secret Santa');
      arrangeBtn.addEventListener('click', function () {
        var msg = f.allocated
          ? 'Secret Santa has already been arranged. Re-arranging will re-shuffle everyone and replace the current assignments. Continue?'
          : 'Randomly assign everyone in ' + f.name + ' a person to buy for?';
        if (!window.confirm(msg)) return;
        arrangeBtn.disabled = true;
        api('POST', base + '/arrange').then(function () { toast('Secret Santa arranged!'); familyView(id); },
          function (ex) { arrangeBtn.disabled = false; toast(ex.message); });
      });

      mount([
        h('p', { class: 'small' }, h('a', { href: '#/families', text: '← My Families' })),
        h('div', { class: 'card' },
          h('div', { class: 'eyebrow', text: 'Family' }),
          h('h1', { text: f.name }),
          h('div', { class: 'row' }, h('span', { class: 'muted small', text: 'Join code:' }), h('span', { class: 'code-badge', text: f.code }), copyButton(f.code))
        ),
        assignmentCard,
        h('div', { class: 'card' },
          h('h2', { text: 'Members (' + f.members.length + ')' }),
          others.length ? h('p', { class: 'small muted', text: 'Open a member to see their ideas and add secret suggestions for them.' }) : null,
          memberList
        ),
        h('div', { class: 'card' },
          h('h2', { text: 'Secret Santa draw' }),
          h('p', { class: 'small muted', text: f.allocated
            ? 'Arranged' + (f.allocatedAt ? ' on ' + new Date(f.allocatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '') + '. Re-arranging will re-shuffle everyone.'
            : (enough ? 'When everyone has joined, arrange the draw to give each person someone to buy for.' : 'You need at least 2 members to arrange Secret Santa. Share the join code above.') }),
          arrangeBtn
        )
      ]);
    }, function (ex) {
      mount(h('div', { class: 'card' },
        h('p', { class: 'error', text: ex.status === 403 ? 'You are not a member of this family.' : ex.message }),
        h('a', { href: '#/families', text: '← Back to My Families' })));
    });
  }

  function memberPanel(base, m) {
    var path = base + '/members/' + encodeURIComponent(m.id);
    var panel = h('div', { class: 'member-panel' }, loading());
    function load() {
      api('GET', path).then(function (d) {
        panel.textContent = '';
        var name = d.member ? d.member.name : m.name;
        append(panel, [
          h('h3', { class: 'section-title', style: 'margin-top:0', text: name + '’s own ideas' }),
          presentList(d.ideas, 'No ideas added yet.'),
          h('h3', { class: 'section-title', text: 'Secret suggestions for ' + name }),
          h('div', { class: 'secret-note', text: '🤫 ' + name + ' can never see these suggestions — only other family members can.' }),
          presentList(d.suggestions, 'No suggestions yet. Be the first!', { showSuggester: true }),
          h('h3', { class: 'section-title', text: 'Add a secret suggestion' }),
          presentForm({
            submitLabel: 'Add suggestion',
            onSubmit: function (payload) {
              return api('POST', path + '/suggestions', payload).then(function () { toast('Suggestion added'); load(); });
            }
          })
        ]);
      }, function (ex) { panel.textContent = ''; append(panel, h('p', { class: 'error', text: ex.message })); });
    }
    load();
    return panel;
  }

  // ---------- Views: profile ----------
  function profileView() {
    var listCard = h('div', { class: 'card' }, loading());
    var addCard = h('div', { class: 'card' },
      h('h2', { text: 'Add an idea' }),
      presentForm({
        submitLabel: 'Add idea',
        resetOnSuccess: true,
        onSubmit: function (payload) {
          return api('POST', '/api/presents', payload).then(function () { toast('Idea added'); loadList(); });
        }
      })
    );
    mount([
      h('div', { class: 'page-head' }, h('h1', { text: 'My Present Profile' })),
      h('p', { class: 'muted', text: 'Add things you’d love to receive. Everyone in your families can see these ideas.' }),
      addCard,
      listCard
    ]);

    function loadList() {
      api('GET', '/api/presents/mine').then(function (d) {
        listCard.textContent = '';
        append(listCard, h('h2', { text: 'My ideas' }));
        if (!d.ideas.length) { append(listCard, h('p', { class: 'empty', text: 'No ideas yet — add your first one above.' })); return; }
        append(listCard, h('ul', { class: 'list' }, d.ideas.map(function (p) {
          var li;
          var actions = h('div', { class: 'row' },
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: function () { editInline(li, p); } }, 'Edit'),
            h('button', { class: 'btn btn-danger-ghost btn-sm', type: 'button', onclick: function () {
              if (!window.confirm('Delete “' + p.itemName + '”?')) return;
              api('DELETE', '/api/presents/' + encodeURIComponent(p.id)).then(function () { toast('Idea deleted'); loadList(); }, function (ex) { toast(ex.message); });
            } }, 'Delete'));
          li = presentItem(p, { actions: actions });
          return li;
        })));
      }, function (ex) { listCard.textContent = ''; append(listCard, h('p', { class: 'error', text: ex.message })); });
    }

    function editInline(li, p) {
      li.textContent = '';
      append(li, h('div', { class: 'member-panel', style: 'margin-top:0' },
        presentForm({
          initial: p,
          submitLabel: 'Save changes',
          sendNulls: true,
          extraButtons: h('button', { class: 'btn btn-ghost', type: 'button', onclick: loadList }, 'Cancel'),
          onSubmit: function (payload) {
            return api('PUT', '/api/presents/' + encodeURIComponent(p.id), payload).then(function () { toast('Idea updated'); loadList(); });
          }
        })));
    }

    loadList();
  }

  // ---------- Router ----------
  function route() {
    closeModal();
    var parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    var name = parts[0];
    updateNav();
    if (!currentUser) {
      if (name === 'register') return authView(true);
      if (name !== 'login') { location.replace('#/login'); return; }
      return authView(false);
    }
    switch (name) {
      case 'login':
      case 'register':
      case '':
        location.replace('#/families'); return;
      case 'families': return familiesView();
      case 'family': return parts[1] ? familyView(decodeURIComponent(parts[1])) : go('#/families');
      case 'profile': return profileView();
      default: location.replace('#/families');
    }
  }

  window.addEventListener('hashchange', route);

  // ---------- Boot ----------
  mount(loading());
  api('GET', '/api/auth/me').then(function (d) { currentUser = d.user; }, function () { currentUser = null; })
    .then(route);
})();
