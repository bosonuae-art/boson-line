/* Offline shell, so the sheet opens on a bad connection and can be installed to
   a home screen.

   Network first, cache as the fallback. The other way round is faster but means
   a push can sit unseen behind a stale cache for a reload or two, and this app
   is edited far more often than it is opened on a train. Only same-origin GETs
   are touched: ESPN, Google Fonts and Firestore are left to the browser, which
   already handles their caching and must not be served a stale score. */
const VERSION = "bl-2026-09-4";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./assets/styles.css", "./assets/app.js", "./assets/store.js",
  "./assets/data.js", "./assets/demo.js", "./config.js",
  "./icons/icon-192.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(VERSION)
      .then(function(c){ return c.addAll(SHELL); })
      .then(function(){ return self.skipWaiting(); })
      .catch(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.filter(function(k){ return k !== VERSION; })
                               .map(function(k){ return caches.delete(k); }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function(res){
      if (res && res.ok && res.type === "basic"){
        const copy = res.clone();
        caches.open(VERSION).then(function(c){ c.put(req, copy); }).catch(function(){});
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(hit){
        if (hit) return hit;
        /* A navigation with nothing cached for that exact URL still wants the
           app, not a browser error page. */
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});
