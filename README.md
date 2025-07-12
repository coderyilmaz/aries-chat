# Aries Chat - Real-Time Mesajlaşma Sistemi

Node.js ve modern web teknolojileri kullanılarak geliştirilmiş gerçek zamanlı mesajlaşma sistemi.

## İçindekiler

- [Özellikler](#özellikler)
- [Teknolojiler](#teknolojiler)
- [Kurulum](#kurulum)
- [API Dokümantasyonu](#api-dokümantasyonu)
- [Proje Yapısı](#proje-yapısı)
- [Kullanım](#kullanım)
- [Çevre Değişkenleri](#çevre-değişkenleri)
- [Socket.IO Event'leri](#socketio-eventleri)
- [Lisans](#lisans)

## Özellikler

### Kimlik Doğrulama
- JWT-based authentication (access + refresh tokens)
- Rate limiting
- Input validation
- XSS koruması
- Data encryption/decryption

### Mesajlaşma
- Real-time mesaj gönderimi ve alımı
- Read receipts (okundu bilgisi)
- Typing indicators (yazıyor göstergesi)
- Message delivery status
- Mesaj silme (kendim için / herkes için)

### Dosya Yönetimi
- Çoklu format desteği (image, video, audio, documents)
- Base64 processing
- Dosya indirme endpointleri
- File validation

### Kullanıcı Yönetimi
- User registration & login
- Profile management
- Avatar upload
- Online/offline status
- User search

### Konuşma Yönetimi
- Private conversations
- Unread message counts
- Conversation statistics

### Otomatik Sistem
- Scheduled automatic messages
- 3-stage automation (Planning → Queuing → Delivery)
- Random user pairing
- RabbitMQ-based processing

### Monitoring
- Winston logging
- Health check endpoints
- System metrics
- Redis caching

## Teknolojiler

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web framework
- **Socket.IO** - Real-time communication
- **MongoDB** - NoSQL database
- **Mongoose** - MongoDB ODM

### Message Queue & Cache
- **RabbitMQ** - Message queue
- **Redis** - In-memory store

### Authentication & Security
- **JWT** - JSON Web Tokens
- **bcryptjs** - Password hashing
- **Helmet** - Security headers
- **express-rate-limit** - Rate limiting

### Utilities
- **node-cron** - Scheduled jobs
- **Winston** - Logging
- **Swagger** - API documentation
- **express-validator** - Input validation

## Kurulum

### Gereksinimler
- Node.js (v16+)
- MongoDB
- Redis
- RabbitMQ

### Adımlar

1. **Projeyi klonlayın**
```bash
git clone https://github.com/coderyilmaz/aries-chat.git
cd aries-chat
```

2. **Dependencies yükleyin**
```bash
npm install
```

3. **Environment variables ayarlayın**
`.env` dosyası oluşturun:
```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/arieschat
JWT_SECRET=your_jwt_secret_change_in_production
JWT_REFRESH_SECRET=your_refresh_secret_change_in_production
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost:5672
ENCRYPTION_KEY=your_encryption_key_32_chars_minimum
```

4. **Servisleri başlatın**
```bash
# MongoDB
mongod

# Redis
redis-server

# RabbitMQ
rabbitmq-server
```

5. **Uygulamayı çalıştırın**
```bash
npm run dev
```

## API Dokümantasyonu

Swagger UI: `http://localhost:3000/api-docs`

### Hızlı test

1. **Register:**
   ```bash
   POST /api/auth/register
   {
     "username": "test",
     "email": "test@test.com", 
     "password": "123456",
     "firstName": "Test",
     "lastName": "User"
   }
   ```

2. **Login:**
   ```bash
   POST /api/auth/login
   {
     "email": "test@test.com",
     "password": "123456"
   }
   ```

3. **Token'ı header'a ekleyin:**
   ```
   Authorization: Bearer <token>
   X-Session-ID: <uuid>
   ```

## Proje Yapısı

```
aries-chat/
├── middleware/
│   └── auth.js
├── models/
│   ├── User.js
│   ├── Conversation.js
│   ├── Message.js
│   └── AutoMessage.js
├── routes/
│   ├── auth.js
│   ├── user.js
│   ├── conversation.js
│   └── message.js
├── services/
│   ├── socketService.js
│   ├── redisService.js
│   ├── queueService.js
│   └── cronService.js
├── utils/
│   ├── logger.js
│   └── base64Helper.js
├── public/
├── logs/
├── swagger.js
├── server.js
├── package.json
├── .env.example
└── README.md
```

## Kullanım

### Socket.IO bağlantısı
```javascript
const socket = io('http://localhost:3000', {
  auth: {
    token: 'jwt_token',
    sessionId: 'session_id'
  }
});

// Odaya katıl
socket.emit('join_room', {
  conversationId: 'conversation_id',
  sessionId: 'session_id'
});

// Mesaj gönder
socket.emit('send_message', {
  conversationId: 'conversation_id',
  content: 'Hello!',
  type: 'text',
  sessionId: 'session_id'
});

// Mesaj dinle
socket.on('message_received', (data) => {
  console.log('Yeni mesaj:', data.message);
});
```

### Dosya gönderimi
```javascript
socket.emit('send_message', {
  conversationId: 'conversation_id',
  content: 'photo.jpg',
  type: 'image',
  fileData: {
    name: 'photo.jpg',
    type: 'image/jpeg',
    data: 'data:image/jpeg;base64,/9j/4AAQ...'
  },
  sessionId: 'session_id'
});
```

## Çevre Değişkenleri

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `MONGODB_URI` | MongoDB URL | `mongodb://localhost:27017/arieschat` |
| `JWT_SECRET` | JWT secret | - |
| `REDIS_URL` | Redis URL | `redis://localhost:6379` |
| `RABBITMQ_URL` | RabbitMQ URL | `amqp://localhost:5672` |

## Socket.IO Event'leri

### Client → Server
- `join_room` - Odaya katılma
- `send_message` - Mesaj gönderme
- `typing_start` - Yazma başlangıcı
- `typing_stop` - Yazma bitişi
- `mark_messages_read` - Okundu işaretleme

### Server → Client  
- `message_received` - Yeni mesaj
- `message_sent` - Mesaj gönderildi
- `user_typing` - Kullanıcı yazıyor
- `user_online` - Kullanıcı online
- `user_offline` - Kullanıcı offline

## Otomatik Mesaj Sistemi

### 1. Planlama (02:00)
- Aktif kullanıcıları çeker
- Random eşleştirme yapar
- AutoMessage'a kaydeder

### 2. Kuyruklama (her dakika)
- Zamanı gelen mesajları tespit eder
- RabbitMQ'ya gönderir

### 3. Delivery (RabbitMQ Consumer)
- Kuyruktan alır
- Database'e kaydeder
- Socket.IO ile gönderir

## Test

### Health check
```bash
curl http://localhost:3000/health
```

### Swagger UI
`http://localhost:3000/api-docs` adresinden tüm endpointleri test edebilirsiniz.

## Loglar

- `logs/combined.log` - Tüm loglar
- `logs/error.log` - Hatalar

## Lisans

Bu proje MIT lisansı altında yayınlanmıştır. Detaylar için [LICENSE](LICENSE) dosyasına bakınız.

---

**Backend Developer Case Study**  
**Repository:** https://github.com/coderyilmaz/aries-chat  
**Stack:** Node.js, Express.js, MongoDB, Socket.IO, Redis, RabbitMQ
