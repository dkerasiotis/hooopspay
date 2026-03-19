# HoopsPay — Διαχείριση Πληρωμών

Εφαρμογή διαχείρισης πληρωμών για δραστηριότητες (αθλητικές, εκπαιδευτικές κ.λπ.).
**Stack:** Node.js + Express + SQLite + Docker

---

## Χαρακτηριστικά

- **Multi-user** — Πολλαπλοί χρήστες με ρόλους (admin / user)
- **Δραστηριότητες** — Κάθε χρήστης βλέπει μόνο τις δικές του, ο admin βλέπει όλες
- **Πληρωμές** — Μηνιαία παρακολούθηση, bulk πληρωμές, ιστορικό
- **Αναφορές** — Dashboard, γραφήματα, αναφορά δασκάλου, export CSV
- **Backup/Restore** — JSON export/import μέσω UI ή API
- **Login** — Hashed passwords (bcrypt), session-based auth
- **Docker** — Single container, SQLite σε persistent volume

---

## Γρήγορη Εκκίνηση

### Προαπαιτούμενα
- Docker & Docker Compose

### 1. Εκκίνηση
```bash
git clone https://github.com/dkerasiotis/hooopspay.git
cd hooopspay
docker compose up -d --build
```

Η εφαρμογή τρέχει στο: **http://localhost:5002**

### 2. Πρώτη Σύνδεση

| Username | Password |
|----------|----------|
| `admin`  | `admin`  |

> **Άλλαξε τον κωδικό αμέσως** από Ρυθμίσεις → Λογαριασμός.

### 3. Logs
```bash
docker compose logs -f
```

### 4. Διακοπή
```bash
docker compose down
```

---

## Ενημέρωση (όταν αλλάξει κώδικας)
```bash
docker compose down
docker compose up -d --build
```
> Τα δεδομένα **δεν χάνονται** — αποθηκεύονται στο Docker volume `hooopspay_data`.

---

## Χρήστες & Ρόλοι

| Ρόλος | Δικαιώματα |
|-------|------------|
| **admin** | Βλέπει όλες τις δραστηριότητες, διαχείριση χρηστών, backup/restore |
| **user** | Βλέπει μόνο τις δραστηριότητες που δημιούργησε |

- Δημιουργία χρηστών: Ρυθμίσεις → Χρήστες (μόνο admin)
- Αλλαγή κωδικού: Ρυθμίσεις → Λογαριασμός (όλοι)
- Reset κωδικού χρήστη: Ρυθμίσεις → Χρήστες → Reset (μόνο admin)

---

## Backup & Restore

### Μέσω εφαρμογής
Κουμπί **Backup** → Κατέβασε JSON / Εισαγωγή JSON

### Μέσω command line
```bash
# Αντιγραφή βάσης
docker cp hooopspay:/data/hooopspay.db ./backup_$(date +%Y%m%d).db

# JSON backup μέσω API (απαιτεί auth cookie)
curl -c cookies.txt -X POST http://localhost:5002/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASS"}'

curl -b cookies.txt http://localhost:5002/api/backup > backup.json
```

---

## Πρόσβαση από άλλες συσκευές (LAN)

```
http://<IP_SERVER>:5002
```

Βρες την IP του server:
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

---

## Πρόσβαση από internet (Nginx + SSL)

```nginx
server {
    server_name yourdomain.com;
    location / {
        proxy_pass http://localhost:5002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
```bash
certbot --nginx -d yourdomain.com
```

---

## Δομή Project

```
hooopspay/
├── backend/
│   ├── server.js         # Express API + SQLite + Auth
│   └── package.json
├── frontend/
│   ├── index.html        # Single-page app
│   ├── login.html        # Login page
│   └── favicon.svg
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Environment Variables

| Variable | Default | Περιγραφή |
|----------|---------|-----------|
| `PORT` | `5002` | Port εφαρμογής |
| `DB_PATH` | `/data/hooopspay.db` | Διαδρομή βάσης δεδομένων |
| `SESSION_SECRET` | `hoopspay-secret-key` | Secret για sessions |
| `ADMIN_INITIAL_PASS` | `admin` | Αρχικός κωδικός admin (μόνο στο πρώτο boot) |
