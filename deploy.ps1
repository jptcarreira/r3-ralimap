ssh crono "mkdir -p /mnt/r3/var/www/html/r3/ralimap/images"
scp index.html app.js styles.css crono:/mnt/r3/var/www/html/r3/ralimap/
scp images/* crono:/mnt/r3/var/www/html/r3/ralimap/images/
ssh crono "chmod -vR o+r /mnt/r3/var/www/html/r3/ralimap/*"
ssh crono "find /mnt/r3/var/www/html/r3/ralimap -type d -exec chmod o+x {} \;"
ssh crono "sudo systemctl reload nginx"
