(function() {
  var globalHideVapiBtn = document.createElement('style');
  globalHideVapiBtn.textContent = '.vapi-btn{ display: none !important; }';
  document.head.appendChild(globalHideVapiBtn);

  var preconnect = document.createElement('link');
  preconnect.rel = 'preconnect';
  preconnect.href = 'https://fonts.googleapis.com';
  document.head.appendChild(preconnect);

  var fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap';
  document.head.appendChild(fontLink);

  var host = document.createElement('div');
  host.style.setProperty('display', 'block', 'important');
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var styleEl = document.createElement('style');
  styleEl.textContent = "\n  :host{\n    --gunmetal:#1D2024;\n    --panel:#262A30;\n    --panel-raised:#2E333A;\n    --chalk:#F2F0E9;\n    --chalk-dim:#B9B6AC;\n    --orange:#FF6A13;\n    --orange-dim:#7A3A16;\n    --amber:#E8A100;\n    --rivet:#565B64;\n    --rivet-dark:#3A3E45;\n    --good-green:#4C9A5D;\n  }\n  *{box-sizing:border-box;}\n  html,body{margin:0;padding:0;background:transparent;}\n  body{\n    font-family:'Inter',sans-serif;\n    color:var(--chalk);\n  }\n\n  /* ---------- Corner widget shell ---------- */\n  .chat-widget{\n    position:fixed;\n    bottom:20px;\n    right:20px;\n    z-index:1000;\n    display:flex;\n    flex-direction:column;\n    align-items:flex-end;\n  }\n\n  .chat-backdrop{\n    display:none;\n    position:fixed;\n    inset:0;\n    background:rgba(10,11,13,0.6);\n    backdrop-filter:blur(2px);\n    z-index:999;\n  }\n  .chat-backdrop.show{ display:block; }\n\n  /* Desktop: once opened, Daryl takes over as a large centered panel with\n     a dimmed backdrop behind it \u2014 a proper dedicated landing experience\n     instead of a small corner popup. (Mobile has its own true full-screen\n     takeover further down, in the max-width:480px block \u2014 this rule is\n     specifically the desktop/tablet version.) */\n  @media (min-width:481px){\n    .chat-widget.open{\n      top:0; left:0; right:0; bottom:0;\n      width:100vw;\n      align-items:center;\n      justify-content:center;\n    }\n    .chat-widget.open .chat-panel{\n      width:min(760px, 90vw);\n      height:min(760px, 88vh);\n      max-width:none;\n      margin-bottom:0;\n    }\n  }\n\n  .chat-toggle{\n    width:78px;\n    height:172px;\n    border:none;\n    background:transparent;\n    cursor:pointer;\n    position:relative;\n    flex:0 0 auto;\n    padding:0;\n  }\n  .chat-toggle img{\n    display:block;\n    width:100%;\n    height:100%;\n    object-fit:contain;\n    object-position:bottom;\n    filter:drop-shadow(0 8px 16px rgba(0,0,0,0.45));\n  }\n  .chat-toggle:hover img{ transform:scale(1.04); }\n  .chat-toggle .bubble-cta{\n    position:absolute;\n    top:-40px;\n    left:-20px;\n    width:118px;\n    background:var(--orange);\n    color:var(--gunmetal);\n    font-family:'Inter',sans-serif;\n    font-weight:600;\n    font-size:11.5px;\n    line-height:1.25;\n    text-align:center;\n    padding:7px 10px;\n    border-radius:12px 12px 12px 3px;\n    white-space:normal;\n    box-shadow:0 4px 10px rgba(0,0,0,0.35);\n    animation:cta-bob 2.4s ease-in-out infinite;\n  }\n  @keyframes cta-bob{\n    0%,100%{ transform:translateY(0); }\n    50%{ transform:translateY(-4px); }\n  }\n  .chat-toggle .ping{\n    position:absolute;\n    top:36px; right:8px;\n    width:13px; height:13px;\n    border-radius:50%;\n    background:var(--good-green);\n    border:2px solid var(--gunmetal);\n  }\n  .chat-widget.open .chat-toggle{ display:none; }\n\n  .chat-panel{\n    display:none;\n    position:relative;\n    width:380px;\n    max-width:calc(100vw - 24px);\n    height:min(640px, calc(100vh - 100px));\n    margin-bottom:12px;\n  }\n  .chat-widget.open .chat-panel{ display:flex; flex-direction:column; }\n\n  .crew-chief-card{\n    position:absolute;\n    bottom:0;\n    left:-190px; /* his right side overlaps ~30px into the panel \u2014 actually touching now the image has no dead padding */\n    width:220px; /* larger, and no longer wasted on invisible transparent margins */\n    z-index:2;\n    pointer-events:none;\n  }\n  .crew-chief-card img{\n    display:block;\n    width:100%;\n    filter:drop-shadow(0 10px 14px rgba(0,0,0,0.45));\n  }\n  .crew-chief-card .cc-caption{\n    position:absolute;\n    bottom:6px;\n    left:50%;\n    transform:translateX(-50%);\n    font-family:'JetBrains Mono',monospace;\n    font-size:8px;\n    color:var(--chalk);\n    background:rgba(29,32,36,0.75);\n    border:0.5px solid var(--rivet-dark);\n    padding:2px 7px;\n    border-radius:3px;\n    text-align:center;\n    letter-spacing:0.02em;\n    white-space:nowrap;\n  }\n  @media (max-width:620px){\n    .crew-chief-card{ display:none; }\n  }\n  @media (max-width:480px){\n    /* On a phone, a small floating box in the corner just doesn't work \u2014\n       there's no room to spare. Go full-screen instead, the way basically\n       every real mobile chat/support experience does (Intercom, Zendesk,\n       etc.) \u2014 maximize the actual conversation space rather than fighting\n       to fit a desktop-shaped widget into a small screen.\n       (Simple-selector overrides like .plate, .brand, .chat-panel-close etc.\n       live in the LATER mobile media query near the end of this stylesheet,\n       not here \u2014 CSS cascade order matters for same-specificity rules, and\n       those base styles are defined further down than this block.) */\n    .chat-widget.open{\n      top:0; left:0; right:0; bottom:0;\n      width:100vw;\n      align-items:stretch;\n    }\n    .chat-widget.open .chat-panel{\n      display:flex;\n      width:100vw;\n      max-width:none;\n      height:100dvh;\n      height:100vh; /* fallback for browsers without dvh support */\n      margin-bottom:0;\n    }\n    .chat-widget.open .app{\n      border-radius:0;\n      box-shadow:none;\n      height:100%;\n    }\n    .chat-widget.open .crew-chief-card{ display:none; } /* already hidden below 620px, kept explicit here too */\n  }\n\n  .chat-panel-close{\n    position:absolute;\n    top:10px; right:10px;\n    z-index:3;\n    width:26px; height:26px;\n    border-radius:50%;\n    border:0.5px solid var(--rivet-dark);\n    background:var(--panel-raised);\n    color:var(--chalk-dim);\n    cursor:pointer;\n    font-size:14px;\n    line-height:1;\n    display:flex;\n    align-items:center;\n    justify-content:center;\n  }\n  .chat-panel-close:hover{ color:var(--chalk); border-color:var(--orange); }\n\n  .chat-home-link{\n    position:absolute;\n    top:-16px; left:-95px;\n    z-index:3;\n    font-family:'Inter',sans-serif;\n    font-size:13px;\n    font-weight:700;\n    color:#fff;\n    text-decoration:none;\n    background:var(--orange);\n    padding:8px 14px;\n    border-radius:14px 14px 14px 3px;\n    box-shadow:0 3px 10px rgba(255,106,19,0.45);\n    white-space:nowrap;\n  }\n  .chat-home-link:hover{ background:#E85A0A; box-shadow:0 4px 14px rgba(255,106,19,0.6); }\n\n  .app{\n    width:100%;\n    max-width:none;\n    height:100%;\n    display:flex;\n    flex-direction:column;\n    overflow:hidden;\n    border-radius:12px;\n    box-shadow:0 16px 40px rgba(0,0,0,0.45);\n    background:\n      linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 120px),\n      var(--gunmetal);\n  }\n\n  /* ---------- Spec-plate header ---------- */\n  .plate{\n    position:relative;\n    margin:14px 14px 0 14px;\n    padding:18px 20px 16px 20px;\n    background:linear-gradient(155deg,#33383F,#23262B 70%);\n    border:1px solid var(--rivet-dark);\n    border-radius:16px;\n    box-shadow:0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 18px rgba(0,0,0,0.28);\n  }\n  /* Rivets removed \u2014 literal screw-head details were reading as too\n     industrial/hardware-store for a customer-facing entry point. */\n\n  .plate-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;}\n  .brand{\n    font-family:'Bebas Neue',sans-serif;\n    font-size:32px;\n    letter-spacing:1px;\n    color:var(--chalk);\n    line-height:1;\n  }\n  .brand span{color:var(--orange);}\n  .plate-badge{\n    font-family:'Inter',sans-serif;\n    font-size:11px;\n    color:var(--gunmetal);\n    background:var(--amber);\n    padding:5px 11px;\n    border-radius:12px;\n    font-weight:600;\n    white-space:nowrap;\n  }\n  .plate-sub{\n    font-family:'Inter',sans-serif;\n    font-size:12.5px;\n    color:var(--chalk-dim);\n    margin-top:6px;\n  }\n\n  /* ---------- torque gauge (signature element) ---------- */\n  .gauge-row{\n    display:flex;\n    align-items:center;\n    gap:10px;\n    margin-top:12px;\n    padding-top:12px;\n    border-top:1px solid var(--rivet-dark);\n  }\n  .gauge{width:34px;height:34px;flex:0 0 auto;}\n  .gauge-needle{\n    transform-origin:17px 17px;\n    transform:rotate(-55deg);\n    transition:transform 0.4s cubic-bezier(.34,1.56,.64,1);\n  }\n  .gauge-label{\n    font-family:'Inter',sans-serif;\n    font-size:12px;\n    color:var(--chalk-dim);\n  }\n  .gauge-label b{color:var(--good-green);font-weight:700;}\n  .gauge.thinking .gauge-needle{\n    animation:tick 0.9s ease-in-out infinite;\n  }\n  @keyframes tick{\n    0%{transform:rotate(-55deg);}\n    50%{transform:rotate(55deg);}\n    100%{transform:rotate(-55deg);}\n  }\n\n  /* ---------- ticket / chat log ---------- */\n  .ticket{\n    flex:1;\n    margin:14px 14px 0 14px;\n    background:var(--panel);\n    border:1px solid var(--rivet-dark);\n    border-radius:6px 6px 0 0;\n    border-bottom:none;\n    position:relative;\n    display:flex;\n    flex-direction:column;\n    min-height:0;\n  }\n  .ticket::before{\n    content:\"\";\n    position:absolute;\n    top:-1px;left:16px;right:16px;\n    height:0;\n    border-top:2px dashed var(--rivet);\n    opacity:0.35;\n  }\n  .log{\n    flex:1;\n    overflow-y:auto;\n    padding:20px 16px 10px 16px;\n    display:flex;\n    flex-direction:column;\n    gap:14px;\n    min-height:220px;\n    max-height:52vh;\n  }\n  .msg{\n    max-width:88%;\n    padding:11px 13px;\n    border-radius:8px;\n    font-size:14.5px;\n    line-height:1.5;\n    white-space:pre-wrap;\n  }\n  .msg-link{\n    color:var(--orange);\n    text-decoration:underline;\n    word-break:break-all;\n  }\n  .msg-link:hover{ color:var(--chalk); }\n  .msg.user{\n    align-self:flex-end;\n    background:var(--orange-dim);\n    border:1px solid rgba(255,106,19,0.35);\n    color:var(--chalk);\n    border-bottom-right-radius:2px;\n  }\n  .msg.bot{\n    align-self:flex-start;\n    background:var(--panel-raised);\n    border:1px solid var(--rivet-dark);\n    color:var(--chalk);\n    border-bottom-left-radius:2px;\n  }\n  .msg.bot b{color:var(--orange);}\n  .msg .tag{\n    display:block;\n    font-family:'JetBrains Mono',monospace;\n    font-size:9.5px;\n    letter-spacing:0.6px;\n    text-transform:uppercase;\n    color:var(--chalk-dim);\n    margin-bottom:5px;\n    opacity:0.75;\n  }\n  .msg.bot .tag{color:var(--orange);}\n  .typing{display:flex;gap:4px;align-items:center;padding:4px 0;}\n  .typing span{\n    width:5px;height:5px;border-radius:50%;\n    background:var(--chalk-dim);\n    animation:blink 1.1s infinite ease-in-out;\n  }\n  .typing span:nth-child(2){animation-delay:0.15s;}\n  .typing span:nth-child(3){animation-delay:0.3s;}\n  @keyframes blink{0%,80%,100%{opacity:0.25;}40%{opacity:1;}}\n\n  /* ---------- quick chips ---------- */\n  .chips{\n    display:flex;\n    flex-wrap:wrap;\n    gap:8px;\n    padding:12px 14px;\n    background:var(--panel);\n    border-left:1px solid var(--rivet-dark);\n    border-right:1px solid var(--rivet-dark);\n  }\n  .chip{\n    flex:0 0 auto;\n    max-width:100%;\n    font-family:'Inter',sans-serif;\n    font-size:12.5px;\n    line-height:1.3;\n    color:var(--chalk-dim);\n    background:var(--panel-raised);\n    border:1px solid transparent;\n    padding:8px 13px;\n    border-radius:14px;\n    cursor:pointer;\n    white-space:normal;\n    transition:border-color 0.15s ease, color 0.15s ease;\n  }\n  .chip:hover{border-color:var(--orange);color:var(--chalk);}\n\n  /* ---------- input keypad ---------- */\n  .keypad-wrap{\n    margin:0 14px 14px 14px;\n  }\n  .attach-preview{\n    display:none;\n    align-items:center;\n    gap:10px;\n    background:var(--panel-raised);\n    border:1px solid var(--rivet-dark);\n    border-bottom:none;\n    border-radius:6px 6px 0 0;\n    padding:10px 12px;\n  }\n  .attach-preview.show{display:flex;}\n  .attach-thumbs{\n    display:flex;\n    gap:8px;\n    overflow-x:auto;\n    flex:0 1 auto;\n  }\n  .attach-thumb{\n    position:relative;\n    flex:0 0 auto;\n    width:48px;height:48px;\n  }\n  .attach-thumb img{\n    width:48px;height:48px;\n    object-fit:cover;\n    border-radius:4px;\n    border:1px solid var(--rivet-dark);\n    display:block;\n  }\n  .attach-thumb .thumb-remove{\n    position:absolute;\n    top:-6px;right:-6px;\n    width:18px;height:18px;\n    border-radius:50%;\n    background:var(--gunmetal);\n    border:1px solid var(--rivet-dark);\n    color:var(--chalk-dim);\n    font-size:11px;\n    line-height:1;\n    display:flex;\n    align-items:center;\n    justify-content:center;\n    cursor:pointer;\n    padding:0;\n  }\n  .attach-thumb .thumb-remove:hover{color:var(--chalk);border-color:var(--orange);}\n  .attach-preview .attach-label{\n    flex:1;\n    font-family:'JetBrains Mono',monospace;\n    font-size:11px;\n    color:var(--chalk-dim);\n    white-space:nowrap;\n  }\n  .attach-preview button:not(.thumb-remove){\n    background:none;\n    border:1px solid var(--rivet-dark);\n    color:var(--chalk-dim);\n    border-radius:4px;\n    font-size:11px;\n    padding:5px 9px;\n    cursor:pointer;\n    font-family:'JetBrains Mono',monospace;\n    flex:0 0 auto;\n  }\n  .attach-preview button:not(.thumb-remove):hover{color:var(--chalk);border-color:var(--orange);}\n  .keypad{\n    background:var(--panel-raised);\n    border:1px solid var(--rivet-dark);\n    border-radius:0 0 6px 6px;\n    padding:12px;\n    display:flex;\n    gap:8px;\n    align-items:flex-end;\n  }\n  button.attach{\n    flex:0 0 auto;\n    background:var(--gunmetal);\n    border:1px solid var(--rivet-dark);\n    color:var(--chalk-dim);\n    border-radius:5px;\n    padding:10px 12px;\n    cursor:pointer;\n    font-size:17px;\n    line-height:1;\n    transition:border-color 0.15s, color 0.15s;\n  }\n  button.attach:hover{border-color:var(--orange);color:var(--chalk);}\n  button.attach:disabled{opacity:0.4;cursor:not-allowed;}\n  .attach-menu-wrap{position:relative;flex:0 0 auto;}\n  .attach-menu{\n    display:none;\n    position:absolute;\n    bottom:calc(100% + 8px);\n    left:0;\n    flex-direction:column;\n    gap:4px;\n    background:var(--panel-raised);\n    border:1px solid var(--rivet-dark);\n    border-radius:6px;\n    padding:6px;\n    box-shadow:0 8px 18px rgba(0,0,0,0.4);\n    z-index:20;\n    min-width:190px;\n  }\n  .attach-menu.show{display:flex;}\n  .attach-menu button{\n    background:none;\n    border:none;\n    color:var(--chalk);\n    text-align:left;\n    padding:9px 10px;\n    border-radius:4px;\n    cursor:pointer;\n    font-family:'Inter',sans-serif;\n    font-size:13.5px;\n    white-space:nowrap;\n  }\n  .attach-menu button:hover{background:var(--gunmetal);color:var(--orange);}\n  .msg img.attached{\n    display:block;\n    max-width:220px;\n    border-radius:6px;\n    margin-bottom:6px;\n    border:1px solid var(--rivet-dark);\n  }\n  textarea{\n    flex:1;\n    resize:none;\n    background:var(--gunmetal);\n    border:1px solid var(--rivet-dark);\n    border-radius:5px;\n    color:var(--chalk);\n    font-family:'Inter',sans-serif;\n    font-size:14.5px;\n    padding:10px 12px;\n    min-height:22px;\n    max-height:120px;\n    line-height:1.4;\n  }\n  textarea:focus{outline:none;border-color:var(--orange);}\n  textarea::placeholder{color:var(--chalk-dim);}\n  button.send{\n    font-family:'Oswald',sans-serif;\n    font-weight:600;\n    letter-spacing:0.5px;\n    text-transform:uppercase;\n    font-size:12.5px;\n    background:var(--orange);\n    color:#241000;\n    border:none;\n    border-radius:5px;\n    padding:12px 16px;\n    cursor:pointer;\n    transition:filter 0.15s;\n    flex:0 0 auto;\n  }\n  button.send:hover{filter:brightness(1.08);}\n  button.send:disabled{opacity:0.5;cursor:not-allowed;}\n\n  .footnote{\n    text-align:center;\n    font-family:'JetBrains Mono',monospace;\n    font-size:10px;\n    color:var(--rivet);\n    letter-spacing:0.3px;\n    padding:0 20px 18px 20px;\n  }\n\n  /* ---------- Voice mode ---------- */\n  .mode-select-view{\n    display:none;\n    flex:1;\n    flex-direction:column;\n    align-items:center;\n    justify-content:center;\n    gap:14px;\n    padding:20px;\n    text-align:center;\n    overflow-y:auto; /* safety net \u2014 shouldn't be needed if the content above fits, but never invisible/cut off if it doesn't */\n    min-height:0;\n  }\n  .mode-select-heading{\n    font-family:'Inter',sans-serif;\n    font-size:18px;\n    font-weight:600;\n    color:var(--chalk);\n  }\n  .mode-select-channels{\n    display:flex;\n    gap:12px;\n  }\n  .mode-channel-btn{\n    display:flex;\n    flex-direction:column;\n    align-items:center;\n    gap:4px;\n    background:linear-gradient(180deg, var(--orange), #E85A0A);\n    border:none;\n    color:#fff;\n    border-radius:18px;\n    padding:14px 32px;\n    cursor:pointer;\n    font-family:'Inter',sans-serif;\n    font-size:14px;\n    font-weight:600;\n    box-shadow:0 4px 14px rgba(255,106,19,0.32);\n    transition:transform 0.15s ease, box-shadow 0.15s ease;\n  }\n  .mode-channel-btn:hover{ transform:translateY(-1px); box-shadow:0 6px 18px rgba(255,106,19,0.42); }\n  .mode-channel-icon{ font-size:22px; }\n\n  .mode-select-or{\n    font-family:'Inter',sans-serif;\n    font-size:12px;\n    color:var(--chalk-dim);\n  }\n\n  .mode-select-chips{\n    display:flex;\n    flex-direction:column;\n    gap:8px;\n    width:100%;\n    max-width:300px;\n  }\n  .mode-select-chips .chip{\n    cursor:pointer;\n    background:var(--panel-raised);\n    border:1px solid transparent;\n    color:var(--chalk);\n    font-family:'Inter',sans-serif;\n    font-size:13px;\n    line-height:1.35;\n    padding:12px 16px;\n    border-radius:14px;\n    text-align:left;\n    transition:background 0.15s ease, border-color 0.15s ease;\n  }\n  .mode-select-chips .chip:hover{ border-color:var(--orange); background:#343A42; }\n\n  .text-mode-view{\n    display:none;\n    flex-direction:column;\n    flex:1;\n    min-height:0;\n  }\n  /* Vapi's html-script-tag loader injects its own floating call button \u2014\n     we have our own custom Talk button and voice UI, so hide theirs entirely. */\n  .vapi-btn{ display:none !important; }\n\n  .voice-mode-view{\n    display:none;\n    flex:1;\n    flex-direction:column;\n    align-items:center;\n    justify-content:center;\n    gap:14px;\n    padding:24px;\n    text-align:center;\n  }\n  .app[data-mode=\"select\"] .mode-select-view{ display:flex; }\n  .app[data-mode=\"text\"] .text-mode-view{ display:flex; }\n  .app[data-mode=\"voice\"] .voice-mode-view{ display:flex; }\n\n  .voice-status{\n    font-family:'JetBrains Mono',monospace;\n    font-size:12px;\n    letter-spacing:0.05em;\n    color:var(--chalk-dim);\n    text-transform:uppercase;\n  }\n  .voice-orb-btn{\n    background:none;\n    border:none;\n    cursor:pointer;\n    padding:0;\n    display:flex;\n    flex-direction:column;\n    align-items:center;\n    gap:10px;\n  }\n  .voice-orb-btn:hover .voice-orb{ transform:scale(1.04); }\n  .voice-orb-label{\n    font-family:'Inter',sans-serif;\n    font-size:13px;\n    font-weight:500;\n    color:var(--orange);\n  }\n  .voice-orb{\n    width:96px; height:96px;\n    border-radius:50%;\n    background:radial-gradient(circle at 35% 30%, var(--orange), var(--orange-dim));\n    box-shadow:0 0 0 0 rgba(255,106,19,0.45);\n  }\n  .voice-orb.idle{ animation:voice-idle-pulse 2.4s ease-in-out infinite; }\n  .voice-orb.listening{ animation:voice-pulse 1.6s ease-in-out infinite; }\n  .voice-orb.speaking{ animation:voice-pulse 0.5s ease-in-out infinite; }\n  @keyframes voice-pulse{\n    0%{ box-shadow:0 0 0 0 rgba(255,106,19,0.45); }\n    70%{ box-shadow:0 0 0 22px rgba(255,106,19,0); }\n    100%{ box-shadow:0 0 0 0 rgba(255,106,19,0); }\n  }\n  @keyframes voice-idle-pulse{\n    0%{ box-shadow:0 0 0 0 rgba(255,106,19,0.3); }\n    50%{ box-shadow:0 0 0 12px rgba(255,106,19,0); }\n    100%{ box-shadow:0 0 0 0 rgba(255,106,19,0); }\n  }\n  .voice-sub{\n    font-size:13.5px;\n    color:var(--chalk-dim);\n    max-width:280px;\n  }\n  .voice-actions{\n    display:flex;\n    gap:10px;\n    margin-top:8px;\n  }\n  .voice-actions button{\n    font-family:'Inter',sans-serif;\n    font-size:12.5px;\n    font-weight:500;\n    padding:9px 14px;\n    border-radius:6px;\n    cursor:pointer;\n  }\n  .voice-end{\n    background:var(--orange);\n    color:var(--gunmetal);\n    border:none;\n  }\n  .voice-back-text{\n    background:none;\n    color:var(--chalk-dim);\n    border:1px solid var(--rivet-dark);\n    font-family:'Inter',sans-serif;\n    font-size:12.5px;\n    font-weight:500;\n    padding:9px 14px;\n    border-radius:6px;\n    cursor:pointer;\n    margin-top:4px;\n  }\n  .voice-back-text:hover{ color:var(--chalk); border-color:var(--orange); }\n\n  .voice-photo-menu-wrap{ position:relative; }\n  .voice-photo-btn{\n    font-family:'Inter',sans-serif;\n    font-size:12.5px;\n    font-weight:500;\n    padding:9px 14px;\n    border-radius:6px;\n    cursor:pointer;\n    background:none;\n    color:var(--chalk-dim);\n    border:1px solid var(--rivet-dark);\n  }\n  .voice-photo-btn:hover{ color:var(--chalk); border-color:var(--orange); }\n  .voice-photo-status{\n    min-height:16px;\n    font-size:12px;\n    color:var(--chalk-dim);\n    font-family:'JetBrains Mono',monospace;\n  }\n  .voice-photo-status.working{ color:var(--amber); }\n  .voice-photo-status.done{ color:var(--good-green); }\n  .voice-photo-status.error{ color:#E24B4A; }\n\n  ::-webkit-scrollbar{width:8px;}\n  ::-webkit-scrollbar-thumb{background:var(--rivet-dark);border-radius:4px;}\n\n  @media (max-width:480px){\n    .msg{max-width:94%;}\n\n    /* Compact top-bar header instead of the desktop spec-plate treatment \u2014\n       one slim row, not a whole decorative card. This has to live in THIS\n       later media query block (not the earlier one near the top of the\n       stylesheet) because these are same-specificity overrides of .plate,\n       .brand, etc. \u2014 CSS cascade resolves ties by source order, so this\n       needs to come after those base rules are defined. */\n    .plate{\n      margin:0;\n      padding:14px 52px 14px 16px; /* right padding clears the close button */\n      padding-top:calc(14px + env(safe-area-inset-top, 0px));\n      background:var(--gunmetal);\n      border:none;\n      border-radius:0;\n      box-shadow:0 1px 0 var(--rivet-dark);\n    }\n    .plate-top{ align-items:center; }\n    .brand{ font-size:19px; }\n    .plate-badge{ font-size:8.5px; padding:3px 6px; }\n    .plate-sub{ display:none; }\n    .gauge-row{ display:none; }\n\n    .chat-panel-close{\n      top:calc(10px + env(safe-area-inset-top, 0px));\n      right:12px;\n      width:32px; height:32px;\n      font-size:16px;\n    }\n\n    /* A bit more breathing room now that there's a full screen to work\n       with instead of a cramped floating box. */\n    .keypad-wrap{ padding-bottom:env(safe-area-inset-bottom, 0px); }\n  }\n\n  @media (prefers-reduced-motion: reduce){\n    .gauge-needle, .typing span{animation:none !important;transition:none !important;}\n  }\n";
  root.appendChild(styleEl);

  var container = document.createElement('div');
  container.innerHTML = "\n<div class=\"chat-backdrop\" id=\"chatBackdrop\"></div>\n<div class=\"chat-widget\" id=\"chatWidget\">\n\n  <div class=\"chat-panel\">\n    <div class=\"crew-chief-card\">\n      <img src=\"https://rucrak-crew-chief.vercel.app/crew-chief.png\" alt=\"Daryl, rucRak's Crew Chief\">\n      <div class=\"cc-caption\">DARYL \u00b7 ON DUTY</div>\n    </div>\n    <a class=\"chat-home-link\" href=\"https://rucrak.com/\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"Back to rucrak.com\">Continue Shopping \u2192</a>\n    <button class=\"chat-panel-close\" id=\"chatPanelClose\" type=\"button\" title=\"Close chat\" aria-label=\"Close chat\">&times;</button>\n<div class=\"app\">\n\n  <div class=\"plate\">\n    <div class=\"plate-top\">\n      <div class=\"brand\">RUC<span>RAK</span> FIELD SUPPORT</div>\n      <div class=\"plate-badge\">DARYL \u00b7 ON DUTY</div>\n    </div>\n    <div class=\"plate-sub\">Installation \u00b7 Fitment \u00b7 Troubleshooting \u2014 GRUNT / GUNNY / SERGEANT</div>\n\n    <div class=\"gauge-row\">\n      <svg class=\"gauge\" id=\"gauge\" viewBox=\"0 0 34 34\">\n        <path d=\"M4 24 A15 15 0 1 1 30 24\" fill=\"none\" stroke=\"#3A3E45\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n        <path d=\"M11 27 A9 9 0 1 1 23 27\" fill=\"none\" stroke=\"#4C9A5D\" stroke-width=\"3\" stroke-linecap=\"round\" opacity=\"0.55\"/>\n        <g class=\"gauge-needle\" id=\"needle\">\n          <line x1=\"17\" y1=\"17\" x2=\"17\" y2=\"6\" stroke=\"#FF6A13\" stroke-width=\"2\" stroke-linecap=\"round\"/>\n          <circle cx=\"17\" cy=\"17\" r=\"2.2\" fill=\"#F2F0E9\"/>\n        </g>\n      </svg>\n      <div class=\"gauge-label\" id=\"gaugeLabel\">Torque check: <b>GOOD &amp; SNUG</b> \u2014 ask away, crew chief's ready.</div>\n    </div>\n  </div>\n\n  <div class=\"mode-select-view\" id=\"modeSelectView\">\n    <div class=\"mode-select-heading\">What do you need help with?</div>\n    <div class=\"mode-select-channels\">\n      <button class=\"mode-channel-btn\" id=\"modeChooseTextBtn\" type=\"button\">\n        <span class=\"mode-channel-icon\">\ud83d\udcac</span>\n        <span>Type</span>\n      </button>\n      <button class=\"mode-channel-btn\" id=\"modeChooseVoiceBtn\" type=\"button\">\n        <span class=\"mode-channel-icon\">\ud83c\udf99\ufe0f</span>\n        <span>Talk</span>\n      </button>\n    </div>\n    <div class=\"mode-select-or\">or tap a question below</div>\n    <div class=\"mode-select-chips\" id=\"modeSelectChips\"></div>\n  </div>\n\n  <div class=\"text-mode-view\" id=\"textModeView\">\n    <div class=\"ticket\">\n      <div class=\"log\" id=\"log\"></div>\n    </div>\n    <div class=\"chips\" id=\"chips\"></div>\n\n    <div class=\"keypad-wrap\">\n      <div class=\"attach-preview\" id=\"attachPreview\">\n        <div class=\"attach-thumbs\" id=\"attachThumbs\"></div>\n        <span class=\"attach-label\" id=\"attachLabel\">Photos attached \u2014 send with your message</span>\n        <button id=\"attachRemove\" type=\"button\">Clear all</button>\n      </div>\n      <div class=\"keypad\">\n        <input type=\"file\" id=\"fileInputCamera\" accept=\"image/*\" capture=\"environment\" style=\"display:none\">\n        <input type=\"file\" id=\"fileInputGallery\" accept=\"image/*\" multiple style=\"display:none\">\n        <div class=\"attach-menu-wrap\">\n          <button class=\"attach\" id=\"attachBtn\" type=\"button\" title=\"Attach fitment photos\">\ud83d\udcf7</button>\n          <div class=\"attach-menu\" id=\"attachMenu\">\n            <button type=\"button\" id=\"attachMenuCamera\">\ud83d\udcf7 Take Photo</button>\n            <button type=\"button\" id=\"attachMenuGallery\">\ud83d\uddbc\ufe0f Choose from Library</button>\n          </div>\n        </div>\n        <textarea id=\"input\" rows=\"1\" placeholder=\"Type your question...\"></textarea>\n        <button class=\"attach\" id=\"talkBtn\" type=\"button\" title=\"Talk to Daryl\">\ud83c\udf99\ufe0f</button>\n        <button class=\"send\" id=\"sendBtn\">Send</button>\n      </div>\n    </div>\n  </div>\n\n  <div class=\"voice-mode-view\" id=\"voiceModeView\">\n    <div class=\"voice-status\" id=\"voiceStatus\">Ready when you are</div>\n    <button class=\"voice-orb-btn\" id=\"voiceStartBtn\" type=\"button\">\n      <span class=\"voice-orb\" id=\"voiceOrb\"></span>\n      <span class=\"voice-orb-label\">Tap to start talking</span>\n    </button>\n    <div class=\"voice-sub\" id=\"voiceSub\">Crew Chief will start talking as soon as you tap in.</div>\n\n    <input type=\"file\" id=\"voiceFileInputCamera\" accept=\"image/*\" capture=\"environment\" style=\"display:none\">\n    <input type=\"file\" id=\"voiceFileInputGallery\" accept=\"image/*\" style=\"display:none\">\n    <div class=\"voice-photo-menu-wrap\">\n      <button class=\"voice-photo-btn\" id=\"voicePhotoBtn\" type=\"button\" title=\"Send a fitment photo\">\ud83d\udcf7 Send a photo</button>\n      <div class=\"attach-menu\" id=\"voicePhotoMenu\">\n        <button type=\"button\" id=\"voicePhotoMenuCamera\">\ud83d\udcf7 Take Photo</button>\n        <button type=\"button\" id=\"voicePhotoMenuGallery\">\ud83d\uddbc\ufe0f Choose from Library</button>\n      </div>\n    </div>\n    <div class=\"voice-photo-status\" id=\"voicePhotoStatus\"></div>\n\n    <div class=\"voice-actions\" id=\"voiceActiveActions\" style=\"display:none;\">\n      <button class=\"voice-end\" id=\"voiceEndBtn\" type=\"button\">End call</button>\n    </div>\n    <button class=\"voice-back-text\" id=\"voiceBackTextBtn\" type=\"button\">Switch to typing</button>\n  </div>\n\n  <div class=\"footnote\">Answers are grounded in rucRak documentation &amp; verified install transcripts. Safety-critical or undocumented items get flagged, not guessed.</div>\n</div>\n  </div>\n\n  <button class=\"chat-toggle\" id=\"chatToggle\" type=\"button\" title=\"Chat with Daryl\" aria-label=\"Open chat\">\n    <span class=\"bubble-cta\">Questions? Daryl's On Duty.</span>\n    <img src=\"https://rucrak-crew-chief.vercel.app/crew-chief.png\" alt=\"Crew Chief\">\n    <span class=\"ping\"></span>\n  </button>\n\n</div>\n\n\n";
  root.appendChild(container);

  (function(root) {

// System prompt now lives server-side in api/chat.js — never expose it or your API key in the browser.
const CHAT_ENDPOINT = 'https://rucrak-crew-chief.vercel.app/api/chat'; // change to your deployed API URL if hosted separately
const CART_ADD_ENDPOINT = 'https://rucrak-crew-chief.vercel.app/api/cart-add'; // change alongside CHAT_ENDPOINT if hosted separately
const CART_CREATE_ENDPOINT = 'https://rucrak-crew-chief.vercel.app/api/cart-create'; // change alongside CHAT_ENDPOINT if hosted separately

let messages = [];
let pendingImages = []; // array of { base64, mediaType, previewSrc } — cleared after send
const log = root.getElementById('log');
const input = root.getElementById('input');
const sendBtn = root.getElementById('sendBtn');
const gauge = root.getElementById('gauge');
const gaugeLabel = root.getElementById('gaugeLabel');
const fileInputCamera = root.getElementById('fileInputCamera');
const fileInputGallery = root.getElementById('fileInputGallery');
const attachBtn = root.getElementById('attachBtn');
const attachMenu = root.getElementById('attachMenu');
const attachMenuCamera = root.getElementById('attachMenuCamera');
const attachMenuGallery = root.getElementById('attachMenuGallery');
const attachPreview = root.getElementById('attachPreview');
const attachThumbs = root.getElementById('attachThumbs');
const attachLabel = root.getElementById('attachLabel');
const attachRemove = root.getElementById('attachRemove');

const STARTERS = [
  "Which RucRak model do I need for my vehicle?",
  "Can I carry E Bikes on this?",
  "Does this block my backup camera?",
  "Can I access my tailgate?",
  "I have an installation question.",
  "Do I need any thing extra to make it fit my vehicle?"
];

function renderChips(){
  const chips = root.getElementById('chips');
  chips.innerHTML = '';
  STARTERS.forEach(q=>{
    const c = document.createElement('div');
    c.className = 'chip';
    c.textContent = q;
    c.onclick = ()=>{ input.value = q; sendMessage(); };
    chips.appendChild(c);
  });
}
renderChips();

// --- photo attachment: tapping the camera button offers a choice — Take Photo or Choose
// from Library — each routed to its own hidden file input, since relying on a single input
// to offer both options isn't consistent across browsers/devices. ---
attachBtn.addEventListener('click', (e)=>{
  e.stopPropagation();
  attachMenu.classList.toggle('show');
});
document.addEventListener('click', ()=> attachMenu.classList.remove('show'));
attachMenu.addEventListener('click', (e)=> e.stopPropagation());

attachMenuCamera.addEventListener('click', ()=>{
  attachMenu.classList.remove('show');
  fileInputCamera.click();
});
attachMenuGallery.addEventListener('click', ()=>{
  attachMenu.classList.remove('show');
  fileInputGallery.click();
});

// --- voice-mode photo: same take/choose pattern, but instead of queueing for a text
// message, the photo goes straight to analysis and gets injected into the live call. ---
const voicePhotoBtn = root.getElementById('voicePhotoBtn');
const voicePhotoMenu = root.getElementById('voicePhotoMenu');
const voicePhotoMenuCamera = root.getElementById('voicePhotoMenuCamera');
const voicePhotoMenuGallery = root.getElementById('voicePhotoMenuGallery');
const voiceFileInputCamera = root.getElementById('voiceFileInputCamera');
const voiceFileInputGallery = root.getElementById('voiceFileInputGallery');
const voicePhotoStatus = root.getElementById('voicePhotoStatus');

voicePhotoBtn.addEventListener('click', (e)=>{
  e.stopPropagation();
  voicePhotoMenu.classList.toggle('show');
});
document.addEventListener('click', ()=> voicePhotoMenu.classList.remove('show'));
voicePhotoMenu.addEventListener('click', (e)=> e.stopPropagation());

voicePhotoMenuCamera.addEventListener('click', ()=>{
  voicePhotoMenu.classList.remove('show');
  voiceFileInputCamera.click();
});
voicePhotoMenuGallery.addEventListener('click', ()=>{
  voicePhotoMenu.classList.remove('show');
  voiceFileInputGallery.click();
});

function setVoicePhotoStatus(text, kind){
  voicePhotoStatus.textContent = text;
  voicePhotoStatus.className = 'voice-photo-status' + (kind ? ' ' + kind : '');
}

// Lets analyzeVoicePhoto (below) start the call automatically and wait for
// it to actually connect, rather than just erroring if you tap the photo
// button before you've tapped "Tap to start talking" first.
let pendingCallStartResolvers = [];
function waitForVoiceCallActive(){
  if(voiceCallActive) return Promise.resolve();
  return new Promise((resolve)=>{
    pendingCallStartResolvers.push(resolve);
    startVoiceMode();
  });
}

async function analyzeVoicePhoto(file){
  if(!voiceCallActive || !vapiInstance){
    setVoicePhotoStatus('Starting the call first...', 'working');
    await waitForVoiceCallActive();
  }
  setVoicePhotoStatus('Uploading photo...', 'working');
  let imgData;
  try {
    imgData = await compressImageFile(file);
  } catch(err){
    setVoicePhotoStatus(err.message || 'Could not read that photo.', 'error');
    return;
  }

  setVoicePhotoStatus("Crew Chief's looking at it...", 'working');
  try {
    const response = await fetch('https://rucrak-crew-chief.vercel.app/api/analyze-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: [{ media_type: imgData.mediaType, data: imgData.base64 }]
      })
    });
    const data = await response.json();
    if(!response.ok){
      throw new Error((data && data.error) || `Server returned ${response.status}`);
    }
    const analysisText = (data.text || '').trim();
    if(!analysisText){
      throw new Error('Empty analysis returned.');
    }

    // Inject the analysis into the live call as context — the assistant on the call
    // (same Crew Chief persona/voice) will read this and relay it naturally in its
    // own words on its next turn, without the call ending or restarting.
    sendVapiMessage(vapiInstance, {
      role: 'system',
      content: `The customer just sent a photo during this call. Automated fitment analysis of that photo: ${analysisText}\n\nRelay this to the customer naturally in your own voice and style right now — don't read it verbatim or robotically, explain it like you normally would in conversation.`
    }, 'photo analysis handoff');
    setVoicePhotoStatus('Sent — Crew Chief will bring it up.', 'done');
    setTimeout(()=> setVoicePhotoStatus('', ''), 4000);
  } catch(err){
    console.error('Voice photo analysis failed:', err); // full details in console only
    setVoicePhotoStatus("Couldn't get a read on that photo — try again in a moment.", 'error');
  }
}

voiceFileInputCamera.addEventListener('change', (e)=>{
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(file) analyzeVoicePhoto(file);
});
voiceFileInputGallery.addEventListener('change', (e)=>{
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(file) analyzeVoicePhoto(file);
});

const MAX_IMAGES = 6; // cap so a big multi-select doesn't blow up the request size

function renderAttachThumbs(){
  attachThumbs.innerHTML = '';
  pendingImages.forEach((imgData, idx)=>{
    const thumb = document.createElement('div');
    thumb.className = 'attach-thumb';
    const img = document.createElement('img');
    img.src = imgData.previewSrc;
    img.alt = 'Attached photo';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'thumb-remove';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove this photo';
    removeBtn.onclick = ()=>{
      pendingImages.splice(idx, 1);
      if(pendingImages.length === 0){
        attachPreview.classList.remove('show');
      } else {
        renderAttachThumbs();
      }
    };
    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    attachThumbs.appendChild(thumb);
  });
  attachLabel.textContent = pendingImages.length > 1
    ? `${pendingImages.length} photos attached — send with your message`
    : 'Photo attached — send with your message';
}

// Shared by both text-mode attach and voice-mode mid-call photo analysis —
// shrinks to a reasonable max dimension so uploads stay fast/cheap regardless
// of how large the original phone photo is. Returns a Promise.
function compressImageFile(file){
  return new Promise((resolve, reject)=>{
    if(!file.type.startsWith('image/')){
      reject(new Error(`"${file.name}" doesn't look like a photo.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev)=>{
      const img = new Image();
      img.onload = ()=>{
        const MAX_DIM = 1200;
        let w = img.width, h = img.height;
        if(w > h && w > MAX_DIM){ h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; }
        else if(h >= w && h > MAX_DIM){ w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, mediaType: 'image/jpeg', previewSrc: dataUrl });
      };
      img.onerror = ()=> reject(new Error('Could not read that image file.'));
      img.src = ev.target.result;
    };
    reader.onerror = ()=> reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function handleSelectedFiles(fileList, inputEl){
  const files = Array.from(fileList || []);
  if(!files.length) return;

  const room = MAX_IMAGES - pendingImages.length;
  if(room <= 0){
    addMessage('bot', `That's plenty — I can only look at ${MAX_IMAGES} photos at once. Send what you've got or clear some first.`);
    inputEl.value = '';
    return;
  }
  const toProcess = files.slice(0, room);
  if(files.length > room){
    addMessage('bot', `Grabbing the first ${room} of those — ${MAX_IMAGES} photos is my limit per message.`);
  }

  // Sending immediately once photos are picked, rather than leaving them
  // sitting in a "pending" state waiting for a separate Send tap — that
  // in-between state looked like nothing had happened. Wait for every
  // photo in this batch to finish compressing before sending once, not
  // once per photo.
  const compressionPromises = toProcess.map(file=>
    compressImageFile(file)
      .then((imgData)=>{
        pendingImages.push(imgData);
        attachPreview.classList.add('show');
        renderAttachThumbs();
        return true;
      })
      .catch((err)=>{
        addMessage('bot', err.message || 'Had trouble reading that photo — skipping it.');
        return false;
      })
  );

  Promise.all(compressionPromises).then(()=>{
    if(pendingImages.length > 0){
      sendMessage();
    }
  });

  inputEl.value = ''; // allow re-selecting the same file(s) later
}

fileInputCamera.addEventListener('change', (e)=>{
  handleSelectedFiles(e.target.files, fileInputCamera);
});
fileInputGallery.addEventListener('change', (e)=>{
  handleSelectedFiles(e.target.files, fileInputGallery);
});

attachRemove.addEventListener('click', ()=>{
  pendingImages = [];
  attachPreview.classList.remove('show');
});

function escapeHtml(str){
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function formatBotText(str){
  let s = escapeHtml(str);
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // Turn plain URLs into actual tappable links — since Daryl may share
  // install videos, manual pages, etc., these need to be clickable, not
  // just plain text the customer has to manually copy.
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="msg-link">$1</a>');
  return s;
}

function addMessage(role, text, imagePreviewSrcs){
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = role === 'user' ? 'You' : 'Crew Chief';
  div.appendChild(tag);
  const previews = Array.isArray(imagePreviewSrcs) ? imagePreviewSrcs : (imagePreviewSrcs ? [imagePreviewSrcs] : []);
  previews.forEach(src=>{
    const img = document.createElement('img');
    img.className = 'attached';
    img.src = src;
    img.alt = 'Attached photo';
    div.appendChild(img);
  });
  const body = document.createElement('span');
  if(role === 'user'){
    body.textContent = text;
  } else {
    body.innerHTML = formatBotText(text);
  }
  div.appendChild(body);
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function setThinking(on){
  gauge.classList.toggle('thinking', on);
  gaugeLabel.innerHTML = on
    ? 'Torque check: <b style="color:var(--amber)">HOLD YER HORSES...</b>'
    : 'Torque check: <b>GOOD &amp; SNUG</b> — ask away, crew chief\'s ready.';
}


// Core cart-add logic, shared between text mode and voice mode -- both need
// the exact same real Shopify AJAX Cart API call, just with different ways
// of reporting the outcome back (a chat message vs. an injected system
// message into a live call). Same-origin only: this resolves correctly when
// the widget is actually embedded on rucrak.com (real cart session/cookies
// Unified cart system (text AND voice) -- both now go through Shopify's
// Storefront API via our own backend, instead of text mode's old
// /cart/add.js AJAX approach. Real reason for this rebuild: Shopify's own
// community confirms the classic cookie-based cart and the Storefront API
// cart are NOT reliably interoperable -- bridging the two risked ending up
// with two separate, unsynced carts depending on which mode a customer
// used. One consistent cart ID, stored here, used by both modes.
const CART_ID_STORAGE_KEY = 'rucrak_crew_chief_cart_id';

function getStoredCartId(){
  try { return localStorage.getItem(CART_ID_STORAGE_KEY); }
  catch(e){ return null; } // localStorage can throw in some embedded/private-browsing contexts
}
function setStoredCartId(cartId){
  try { localStorage.setItem(CART_ID_STORAGE_KEY, cartId); }
  catch(e){ /* non-fatal -- worst case, a new cart gets created next time */ }
  syncClassicCartCookie(cartId);
}

// Attempt to sync the Storefront API cart into the site's own classic cart
// cookie, so that using the site's native "Add to Cart" buttons (outside of
// Daryl entirely) lands in the SAME cart instead of a separate, disconnected
// one -- a real gap a customer flagged directly. This is an experiment, not
// a guaranteed fix: Shopify's own documentation describes cart
// interoperability between the classic cookie-based cart and the Storefront
// API cart as still rolling out, not universally available. The classic
// cart cookie's value is the "token" portion of a Storefront cart ID (the
// part before any "?key=" secret) -- gid://shopify/Cart/{token} or
// gid://shopify/Cart/{token}?key={secret} either way, extract just the
// token. Wrapped defensively since this touches document.cookie directly
// and should never break the actual cart functionality if it fails.
function syncClassicCartCookie(cartId){
  try {
    if(!cartId) return;
    const afterPrefix = cartId.replace('gid://shopify/Cart/', '');
    const token = afterPrefix.split('?')[0];
    if(!token) return;
    document.cookie = `cart=${token}; path=/; max-age=1209600; SameSite=Lax`;
  } catch(e){
    console.error('Could not sync classic cart cookie (non-fatal, checkout link still works either way):', e);
  }
}

// Ensures a cart ID exists before starting a voice call, since Daryl needs
// it passed in via variableValues at call-start time (variableValues can't
// be updated once a call is already in progress, per Vapi's own docs) --
// creates a fresh cart if none is stored yet. Returns the cart ID, or an
// empty string if creation fails (the voice-mode tool falls back to
// creating its own cart in that case, per api/_cart.js).
async function ensureCartId(){
  const existing = getStoredCartId();
  if(existing) return existing;
  try {
    const res = await fetch(CART_CREATE_ENDPOINT, { method: 'POST' });
    if(!res.ok) throw new Error(`Cart create failed (${res.status})`);
    const data = await res.json();
    setStoredCartId(data.cartId);
    return data.cartId;
  } catch(err){
    console.error('Could not pre-create a cart before starting voice mode (non-fatal, tool will create one itself):', err);
    return '';
  }
}

// Text mode: calls our backend, which calls Shopify's Storefront API.
// Reports the outcome as a normal chat message, using the cart's real
// checkoutUrl rather than a generic /checkout link.
async function addToShopifyCart(cartInstruction){
  const label = cartInstruction.label || 'that item';
  try {
    const res = await fetch(CART_ADD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cartId: getStoredCartId(),
        variantId: cartInstruction.variantId,
        quantity: cartInstruction.quantity || 1
      })
    });
    if(!res.ok){
      const errBody = await res.json().catch(()=>null);
      throw new Error(`Cart add failed (${res.status}): ${(errBody && errBody.detail) || 'no detail returned'}`);
    }
    const data = await res.json();
    setStoredCartId(data.cartId); // may be a freshly-created cart if the old ID was stale
    addMessage('bot', `✅ Added **${label}** to your cart. Head to checkout here: ${data.checkoutUrl} — or hit **Continue Shopping** up top if you want to add more or double check what's in there.`);
  } catch(err){
    console.error('Cart add failed:', err);
    addMessage('bot', `Hmm, that didn't actually make it into your cart — might need to add ${label} yourself on the site, sorry about that.`);
  }
}

// Voice mode's add_to_cart is now a fully server-side Vapi tool (see
// api/add-to-cart-ack.js) -- the browser is no longer involved in
// performing the mutation at all, only in supplying the cart ID at
// call-start time (see startVoiceMode, which reads getStoredCartId() into
// variableValues). Vapi delivers tool-call notifications to EITHER the
// client OR a configured server URL, never both, so there's intentionally
// no browser-side handler for add_to_cart anymore.

async function sendMessage(){
  const text = input.value.trim();
  const hasImages = pendingImages.length > 0;
  if(!text && !hasImages) return;

  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  // Build the outgoing content: array with image(s) (if any) + text, or just a string.
  let outgoingContent;
  if(hasImages){
    const blocks = pendingImages.map(imgData => ({
      type: 'image',
      source: { type: 'base64', media_type: imgData.mediaType, data: imgData.base64 }
    }));
    const defaultText = pendingImages.length > 1
      ? "Here's a few photos for a fitment check — can you take a look?"
      : "Here's a photo for a fitment check — can you take a look?";
    blocks.push({ type: 'text', text: text || defaultText });
    outgoingContent = blocks;
  } else {
    outgoingContent = text;
  }

  const previewSrcs = pendingImages.map(imgData => imgData.previewSrc);
  addMessage('user', text || (pendingImages.length > 1 ? "(photos attached)" : "(photo attached)"), hasImages ? previewSrcs : null);
  messages.push({ role: 'user', content: outgoingContent });

  pendingImages = [];
  attachPreview.classList.remove('show');
  attachThumbs.innerHTML = '';

  const typingDiv = document.createElement('div');
  typingDiv.className = 'msg bot';
  typingDiv.innerHTML = '<span class="tag">Crew Chief</span><div class="typing"><span></span><span></span><span></span></div>';
  log.appendChild(typingDiv);
  log.scrollTop = log.scrollHeight;
  setThinking(true);

  try{
    const response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages })
    });
    const data = await response.json();
    if(!response.ok){
      throw new Error(data && data.error ? data.error : `Server returned ${response.status}`);
    }
    const replyText = (data.text || "").trim() || "Hang on, lost my train of thought — say that again?";
    typingDiv.remove();
    addMessage('bot', replyText);
    messages.push({role:'assistant', content: replyText});

    // Real cart-add, via Shopify's own AJAX Cart API. This is a relative URL
    // on purpose — it only resolves correctly when this widget is actually
    // embedded on rucrak.com itself (same-origin, so the customer's real
    // cart session/cookies apply automatically). On the standalone Vercel
    // test site this will fail, which is expected and fine — there's no real
    // Shopify cart to add to there anyway.
    if(data.addToCart && data.addToCart.variantId){
      await addToShopifyCart(data.addToCart);
    }
  } catch(err){
    typingDiv.remove();
    addMessage('bot', "Well shoot, I'm having some trouble getting connected right now — nothing you did wrong. Give it a minute and try again.");
    console.error("Chat request failed:", err); // full details stay in the browser console, never shown to the customer
  } finally {
    setThinking(false);
    sendBtn.disabled = false;
    input.focus();
  }
}

sendBtn.addEventListener('click', sendMessage);
input.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }
});
input.addEventListener('input', ()=>{
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});

// Widget open/close — greeting fires the first time it's opened, not on page load
const chatWidget = root.getElementById('chatWidget');
const chatToggle = root.getElementById('chatToggle');
const chatPanelClose = root.getElementById('chatPanelClose');
const chatBackdrop = root.getElementById('chatBackdrop');
let hasGreeted = false;

// ==================== Mode management (landing screen / text / voice) ====================
// Three mutually-exclusive modes now instead of a simple voice/text boolean —
// see the .app[data-mode="..."] CSS rules. Persists across closing/reopening
// the widget within the same page load, so someone who already started a
// conversation doesn't get bounced back to square one just for closing the
// panel to look at something else.
let currentMode = 'select';
function setMode(mode){
  currentMode = mode;
  appEl.dataset.mode = mode;
}

function renderModeSelectChips(){
  const container = root.getElementById('modeSelectChips');
  container.innerHTML = '';
  STARTERS.forEach(q=>{
    const c = document.createElement('div');
    c.className = 'chip';
    c.textContent = q;
    c.onclick = ()=>{
      // Tapping a question answers it right away — no extra step. Talk/Type
      // buttons below are still there for someone who wants to ask their
      // own thing instead of picking one of these.
      hasGreeted = true;
      setMode('text');
      input.value = q;
      sendMessage();
    };
    container.appendChild(c);
  });
}
renderModeSelectChips();

root.getElementById('modeChooseTextBtn').addEventListener('click', ()=>{
  setMode('text');
  if(!hasGreeted){
    hasGreeted = true;
    addMessage('bot', "Well hey there, I'm Daryl, rucRak's Crew Chief. Tell me what you're wrestlin' with — install, fitment, or somethin's rattlin' around back there — and let me know which model you've got: GRUNT or GUNNY. What's goin' on?");
  }
});

root.getElementById('modeChooseVoiceBtn').addEventListener('click', ()=>{
  startVoiceMode(); // this itself calls setMode('voice')
});

function openChat(){
  chatWidget.classList.add('open');
  chatBackdrop.classList.add('show');
  setMode(currentMode); // show whichever mode they were last in (or the landing screen, first time)
}
function closeChat(){
  chatWidget.classList.remove('open');
  chatBackdrop.classList.remove('show');
  // Don't leave a call running in the background after the panel's closed.
  if(voiceCallActive && vapiInstance){
    vapiInstance.stop();
  }
  // currentMode is intentionally left as-is — reopening should return to
  // wherever they were, not force them back to the landing screen.
}
chatToggle.addEventListener('click', openChat);
chatPanelClose.addEventListener('click', closeChat);
chatBackdrop.addEventListener('click', closeChat); // clicking outside the panel closes it, like a normal modal

// ==================== VOICE MODE (Vapi) ====================
const VAPI_PUBLIC_KEY = "df87c007-25eb-4771-92c6-8a6a55cdb46c";
const CREW_CHIEF_ASSISTANT_ID = "d890cde2-65a3-42e5-9832-e9697a3c5775"; // model, voice, and the full system prompt all live here now — edit in the Vapi dashboard, not in this file
const GREETING_TEXT = "Well hey there, I'm Daryl, rucRak's Crew Chief. Tell me what you're wrestlin' with — install, fitment, or somethin's rattlin' around back there — and let me know which model you've got: GRUNT or GUNNY. What's goin' on?";
const appEl = root.querySelector('.app');
const talkBtn = root.getElementById('talkBtn');
const voiceStatus = root.getElementById('voiceStatus');
const voiceOrb = root.getElementById('voiceOrb');
const voiceStartBtn = root.getElementById('voiceStartBtn');
const voiceActiveActions = root.getElementById('voiceActiveActions');
const voiceSub = root.getElementById('voiceSub');
const voiceEndBtn = root.getElementById('voiceEndBtn');
const voiceBackTextBtn = root.getElementById('voiceBackTextBtn');

function resetVoiceIdleUI(){
  voiceStatus.textContent = 'Ready when you are';
  voiceOrb.className = 'voice-orb idle';
  voiceSub.textContent = 'Crew Chief will start talking as soon as you tap in.';
  voiceStartBtn.style.display = '';
  voiceActiveActions.style.display = 'none';
}
resetVoiceIdleUI();

let vapiInstance = null;
let voiceCallActive = false;

// Builds a plain-text summary of whatever's already been discussed in text
// mode, so switching to voice doesn't start from a blank slate. Skips raw
// image data (can't usefully summarize a photo we don't have a description
// for) but notes that one was shared, for context.
function buildTextHistorySummary(){
  if(!messages || messages.length === 0) return null;
  const lines = [];
  for(const m of messages){
    const role = m.role === 'user' ? 'Customer' : 'Daryl';
    if(typeof m.content === 'string'){
      lines.push(`${role}: ${m.content}`);
    } else if(Array.isArray(m.content)){
      const textParts = m.content.filter(b => b.type === 'text').map(b => b.text);
      const hadImage = m.content.some(b => b.type === 'image');
      let line = `${role}: ${textParts.join(' ')}`;
      if(hadImage) line += ' [customer also shared a fitment photo here]';
      lines.push(line);
    }
  }
  if(lines.length === 0) return null;
  return lines.join('\n');
}

// Accumulates voice-call turns as they're transcribed, so switching back to
// text mode (or ending the call) can hand that conversation over to text
// mode's history — the reverse direction of the text-to-voice handoff below.
let voiceTranscriptBuffer = [];

function flushVoiceTranscriptToText(){
  if(voiceTranscriptBuffer.length === 0) return;
  for(const turn of voiceTranscriptBuffer){
    addMessage(turn.role === 'user' ? 'user' : 'bot', turn.text);
    messages.push({ role: turn.role === 'user' ? 'user' : 'assistant', content: turn.text });
  }
  voiceTranscriptBuffer = [];
  hasGreeted = true; // don't re-fire the canned text greeting after a real voice conversation happened
}

// Shared, defensive wrapper for injecting a message into a live call —
// tries vapi.send() first (the documented method), falls back to
// vapi.addMessage() if that doesn't exist (an alternate method name seen in
// some Vapi docs), and logs clearly which path was taken or whether both
// failed, since a silent failure here is otherwise impossible to diagnose.
// Only used for genuinely mid-call events now (like a photo analysis result)
// — the initial text-to-voice handoff goes through variableValues at call
// start instead (see startVoiceMode), which is more reliable since it
// doesn't race against the assistant's own opening greeting.
function sendVapiMessage(vapi, message, label){
  try {
    if(typeof vapi.send === 'function'){
      console.log(`Sending ${label} via vapi.send()...`);
      vapi.send({ type: 'add-message', message });
      console.log(`vapi.send() for ${label} completed without throwing.`);
    } else if(typeof vapi.addMessage === 'function'){
      console.log(`vapi.send is not a function on this instance — trying vapi.addMessage() for ${label}...`);
      vapi.addMessage(message);
      console.log(`vapi.addMessage() for ${label} completed without throwing.`);
    } else {
      console.error(`Neither vapi.send nor vapi.addMessage exist on this instance — ${label} cannot be delivered.`);
    }
  } catch(err){
    console.error(`${label} threw an error:`, err);
  }
}

// Vapi error objects can take several different shapes depending on what
// actually went wrong (a plain string, an Error, {message: "..."},
// {message: {...nested...}}, {error: {message: "..."}}, or something else
// entirely) — blindly concatenating err.message produces "[object Object]"
// whenever message itself isn't a plain string. This unpacks it properly so
// the on-screen error text is actually useful instead of that.
function describeVapiError(err){
  if(!err) return 'unknown error';
  if(typeof err === 'string') return err;
  if(typeof err.message === 'string') return err.message;
  if(err.message && typeof err.message === 'object'){
    try { return JSON.stringify(err.message); } catch(e){ /* fall through */ }
  }
  if(err.error && typeof err.error.message === 'string') return err.error.message;
  if(err.error && typeof err.error === 'string') return err.error;
  try { return JSON.stringify(err); } catch(e){ return String(err); }
}

function attachVapiListeners(vapi){
  vapi.on('call-start', ()=>{
    voiceCallActive = true;
    voiceStatus.textContent = 'Connected';
    voiceOrb.className = 'voice-orb listening';
    voiceSub.textContent = "Say what's going on — Crew Chief's listening.";
    voiceStartBtn.style.display = 'none';
    voiceActiveActions.style.display = 'flex';
    voiceTranscriptBuffer = []; // fresh call, don't carry over anything stale

    // If someone tapped "Send a photo" before starting the call, this lets
    // that flow continue now that we're actually connected.
    pendingCallStartResolvers.forEach(resolve => resolve());
    pendingCallStartResolvers = [];
  });

  vapi.on('call-end', ()=>{
    voiceCallActive = false;
    flushVoiceTranscriptToText(); // hand the voice conversation over to text mode's history
    // Back to the idle "tap to start" screen, not text — they can still choose to switch manually.
    resetVoiceIdleUI();
  });

  vapi.on('speech-start', ()=>{
    voiceStatus.textContent = 'Crew Chief is talking...';
    voiceOrb.className = 'voice-orb speaking';
  });

  vapi.on('speech-end', ()=>{
    voiceStatus.textContent = 'Listening...';
    voiceOrb.className = 'voice-orb listening';
  });

  // Captures the live transcript so it can be handed to text mode later —
  // see flushVoiceTranscriptToText above. Requires "transcript" to be
  // enabled in the assistant's clientMessages in the Vapi dashboard; if
  // it's not receiving these, double-check that setting there.
  //
  // General tool-calls logging kept here as diagnostic scaffolding for any
  // future CLIENT-side tools (no server URL) -- add_to_cart used to be
  // handled here, but it's now a fully server-side tool (see
  // api/add-to-cart-ack.js), and Vapi delivers a tool call to EITHER the
  // client OR a configured server URL, never both -- so there's
  // intentionally no dispatch for it here anymore.
  vapi.on('message', (message)=>{
    if(message && message.type === 'transcript' && message.transcriptType === 'final' && message.transcript){
      voiceTranscriptBuffer.push({ role: message.role === 'user' ? 'user' : 'assistant', text: message.transcript });
    }
    // Log every non-transcript message type seen during a call -- cheap
    // insurance for debugging tool-calls delivery without flooding the
    // console with every single transcript chunk.
    if(message && message.type && message.type !== 'transcript'){
      console.log('[voice] message type:', message.type, message);
    }
  });

  vapi.on('error', (err)=>{
    console.error('Vapi error:', err);
    voiceStatus.textContent = "Couldn't connect";
    voiceSub.textContent = 'Error: ' + describeVapiError(err);
    voiceOrb.className = 'voice-orb';
    voiceStartBtn.style.display = '';
    voiceActiveActions.style.display = 'none';
  });
}

// Vapi's raw @vapi-ai/web UMD build doesn't reliably expose window.Vapi when loaded via a
// plain CDN script tag (confirmed dead end). This is Vapi's own officially-documented loader
// for exactly this vanilla-JS/no-bundler scenario instead — loads async, calls vapiSDK.run()
// on completion, and returns an instance with the same on()/start()/stop() API. We hide its
// default floating button via the .vapi-btn CSS rule since we have our own custom UI.
const vapiReadyPromise = new Promise((resolve, reject)=>{
  const script = document.createElement('script');
  script.src = "https://cdn.jsdelivr.net/gh/VapiAI/html-script-tag@latest/dist/assets/index.js";
  script.defer = true;
  script.async = true;
  script.onload = function(){
    try {
      if(!window.vapiSDK){
        reject(new Error('Vapi loader script loaded but window.vapiSDK is missing.'));
        return;
      }
      const vapi = window.vapiSDK.run({
        apiKey: VAPI_PUBLIC_KEY,
        assistant: CREW_CHIEF_ASSISTANT_ID,
        config: {} // default button hidden via CSS — we drive everything through our own UI
      });
      if(!vapi){
        reject(new Error('vapiSDK.run() did not return an instance.'));
        return;
      }
      attachVapiListeners(vapi);
      vapiInstance = vapi;
      resolve(vapi);
    } catch(err){
      reject(err);
    }
  };
  script.onerror = function(){
    reject(new Error('Vapi loader script failed to load from CDN — check network/ad-blockers.'));
  };
  const firstScript = document.getElementsByTagName('script')[0];
  firstScript.parentNode.insertBefore(script, firstScript);
});

// Set right before calling startVoiceMode() when there's a specific topic to
// hand off (e.g. a chip picked from the landing screen). Falls back to the
// prior text conversation if this isn't explicitly set.
let voiceStartContext = null;

function startVoiceMode(){
  setMode('voice');
  voiceStatus.textContent = 'Connecting...';
  voiceOrb.className = 'voice-orb';
  voiceSub.textContent = 'Hang on, getting Crew Chief on the line.';
  voiceStartBtn.style.display = 'none'; // prevent double-tapping while it connects

  // Context handed to the assistant via variableValues, set BEFORE the call
  // starts rather than injected mid-call — this sidesteps an entire class of
  // timing/interruption problems that come with sending a message while the
  // assistant might already be speaking. Requires the Vapi dashboard's
  // system prompt to reference {{priorContext}} and the First Message field
  // to have a conditional greeting based on it (see README/setup notes).
  const contextForCall = voiceStartContext || buildTextHistorySummary() || "";
  voiceStartContext = null; // one-shot, don't leak into the next call

  vapiReadyPromise
    .then(async (vapi)=>{
      // Assistant (model, voice, and the full system prompt) is managed entirely in the
      // Vapi dashboard now — one single source of truth, no duplicated prompt to drift
      // out of sync with. Edit the assistant there, not here.
      // vapiSDK.run() above only sets up the instance — it doesn't start a call on its own,
      // so we always explicitly start one here in response to the tap.
      if(!voiceCallActive){
        const cartIdForCall = await ensureCartId();
        const startResult = vapi.start(CREW_CHIEF_ASSISTANT_ID, {
          variableValues: { priorContext: contextForCall, cartId: cartIdForCall }
        });
        if(startResult && typeof startResult.catch === 'function'){
          startResult.catch((err)=>{
            console.error('Vapi start() rejected:', err);
            voiceStatus.textContent = "Couldn't connect";
            voiceSub.textContent = 'Error: ' + describeVapiError(err);
            voiceOrb.className = 'voice-orb';
            voiceStartBtn.style.display = '';
          });
        }
      }
    })
    .catch((err)=>{
      console.error('Voice mode failed to start:', err);
      voiceStatus.textContent = "Couldn't connect";
      voiceSub.textContent = 'Error: ' + describeVapiError(err);
      voiceOrb.className = 'voice-orb';
      voiceStartBtn.style.display = '';
    });
}

function endVoiceMode(){
  // Stops the call and returns to the voice screen's idle "tap to start"
  // state — stays in voice mode. Use switchToTextMode() to actually leave
  // voice mode for text.
  if(voiceCallActive && vapiInstance){
    vapiInstance.stop();
  }
  resetVoiceIdleUI();
}

function switchToTextMode(){
  if(voiceCallActive && vapiInstance){
    vapiInstance.stop(); // call-end handler flushes the transcript into text mode's history
  }
  resetVoiceIdleUI();
  setMode('text');
}

voiceStartBtn.addEventListener('click', startVoiceMode);
talkBtn.addEventListener('click', startVoiceMode);
voiceEndBtn.addEventListener('click', endVoiceMode);
voiceBackTextBtn.addEventListener('click', switchToTextMode);

  })(root);
})();
