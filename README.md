# 🏀 HoopsPay — Basketball Academy Payment Manager

Πλήρης εφαρμογή διαχείρισης πληρωμών για σχολή μπάσκετ.  
**Stack:** Node.js + Express + SQLite + Docker

---

## 🚀 Γρήγορη Εκκίνηση

### Προαπαιτούμενα
- Docker & Docker Compose

### 1. Εκκίνηση
```bash
git clone <repo> hooopspay
cd hooopspay
docker compose up -d --build
```

Η εφαρμογή τρέχει στο: **http://localhost:3000**

### 2. Για να δεις τα logs
```bash
docker compose logs -f
```

### 3. Για να σταματήσεις
```bash
docker compose down
```

---

## 🔄 Ενημέρωση (όταν αλλάξει κώδικας)
```bash
docker compose down
docker compose up -d --build
```
> Τα δεδομένα **δεν χάνονται** — αποθηκεύονται στο Docker volume `hooopspay_data`.

---

## 💾 Backup & Restore

### Αυτόματο backup μέσω εφαρμογής
Κουμπί **💾 Backup** → Κατέβασε JSON

### Manual backup (από command line)
```bash
# Αντιγραφή της βάσης
docker cp hooopspay:/data/hooopspay.db ./backup_$(date +%Y%m%d).db

# Ή μέσω API
curl http://localhost:3000/api/backup > backup_$(date +%Y%m%d).json
```

### Restore από JSON (command line)
```bash
curl -X POST http://localhost:3000/api/restore \
  -H "Content-Type: application/json" \
  -d @backup_2025-01-01.json
```

---

## 🌐 Πρόσβαση από άλλες συσκευές (LAN)

Αν ο server είναι στο τοπικό δίκτυο:
```
http://<IP_SERVER>:3000
```

Βρες την IP του server:
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

---

## 🔒 Ασφάλεια (για πρόσβαση από internet)

Αν θέλεις πρόσβαση έξω από το τοπικό δίκτυο, βάλε **Nginx reverse proxy + SSL**:

```bash
# Εγκατάσταση certbot
apt install nginx certbot python3-certbot-nginx

# Δημιουργία /etc/nginx/sites-available/hooopspay
server {
    server_name yourdomain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# SSL
certbot --nginx -d yourdomain.com
```

---

## 📁 Δομή Project

```
hooopspay/
├── backend/
│   ├── server.js       # Express API + SQLite
│   └── package.json
├── frontend/
│   └── index.html      # Single-page app
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 🔧 Environment Variables

| Variable | Default | Περιγραφή |
|----------|---------|-----------|
| `PORT` | `3000` | Port εφαρμογής |
| `DB_PATH` | `/data/hooopspay.db` | Διαδρομή βάσης δεδομένων |

Για να αλλάξεις port, επεξεργάσου το `docker-compose.yml`:
```yaml
ports:
  - "8080:3000"   # Τώρα η εφαρμογή ανοίγει στο :8080
```

---

## 💡 Μεταφορά από HTML έκδοση (localStorage)

Αν είχες δεδομένα στην παλιά HTML έκδοση:
1. Άνοιξε την παλιά HTML
2. Κουμπί **💾 Backup** → Κατέβασε JSON
3. Άνοιξε τη νέα εφαρμογή (`http://localhost:3000`)
4. Κουμπί **💾 Backup** → Εισαγωγή JSON → Επίλεξε αρχείο → ✅
