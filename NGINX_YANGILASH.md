# nginx: tibex.uz ochiq sahifalari

`backend/deploy/nginx.conf` oxiridagi `location /` blokini shunga almashtiring
(hozir noma'lum yo'l `/login.html` (xodim kirishi)ga tushadi):

    location = / {
        root /var/www/tibex/frontend;
        try_files /index.html =404;
    }

    location / {
        root /var/www/tibex/frontend;
        autoindex off;
        try_files $uri =404;
    }

Keyin: `sudo nginx -t && sudo systemctl reload nginx`.

Eslatma: "Directory listing for /" yozuvi nginx'dan emas, `python -m http.server`
(start-frontend.bat) dan chiqadi. tibex.uz ga tunnel aynan shu portga qaratilgan
bo'lsa, uni nginx'ga qaratish kerak — aks holda papkadagi hamma fayl ochiq qoladi.
