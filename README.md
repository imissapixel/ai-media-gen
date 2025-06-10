# AI Media Generator PWA

A secure, password-protected Progressive Web App for generating AI-powered images and videos.

## Features

- 🎨 **AI Image Generation** - Create custom images with advanced settings
- 🎬 **AI Video Generation** - Generate videos with various formats and durations
- 🖼️ **Gallery System** - Offline storage of your generated content (up to 50 items)
- 🔐 **Password Protection** - Secure access with persistent authentication
- 📱 **PWA Ready** - Installable as a native app with offline capabilities
- 🍪 **Remember Me** - Login once and stay authenticated

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Edit the `.env` file and set your password:
```env
ACCESS_PASSWORD=your_secure_password_here
SESSION_SECRET=your_super_secret_session_key_here_change_this
```

### 3. Start the Server
```bash
# Development mode (auto-restart on changes)
npm run dev

# Production mode
npm start
```

### 4. Access the Application
Visit `http://localhost:3000` in your browser.

## Security Features

- **Password Hashing**: Uses bcrypt with 12 salt rounds
- **Secure Cookies**: HttpOnly, secure flags for production
- **Persistent Auth**: Login once, remember for 1 year
- **HTTPS Ready**: Security headers and CSP configured
- **Environment Protection**: `.env` file excluded from git

## Authentication Flow

1. **First Visit**: User sees password prompt
2. **Password Entry**: Server verifies against hashed password in `.env`
3. **Success**: Secure cookie set with 1-year expiry
4. **Future Visits**: Cookie automatically grants access

## API Endpoints

- `GET /` - Main application (requires authentication)
- `POST /login` - Authentication endpoint
- `POST /logout` - Clear authentication cookie
- `GET /health` - Health check endpoint

## PWA Installation

The app automatically prompts users to install it as a PWA:
- **Chrome/Edge**: Native install prompt
- **iOS Safari**: Step-by-step installation instructions
- **48-hour Dismiss**: Install prompt reappears after 48 hours if dismissed

## Gallery Storage

- Uses IndexedDB for offline storage
- Stores up to 50 generated items
- Automatically manages storage limits
- Supports both images and videos
- Full-size viewing with metadata

## Development

```bash
# Start development server with auto-reload
npm run dev

# The server will automatically:
# - Generate password hash on first run
# - Update .env file with the hash
# - Serve the application with authentication
```

## Production Deployment

1. Set `NODE_ENV=production` in your environment
2. Use a strong `SESSION_SECRET`
3. Enable HTTPS for secure cookies
4. Consider using a reverse proxy (nginx, Apache)

## File Structure

```
├── server.js              # Express server with authentication
├── ai_content_gen.html    # Main PWA application
├── login.html            # Password entry form
├── manifest.json         # PWA manifest
├── sw.js                # Service worker
├── package.json         # Dependencies
├── .env                 # Environment configuration
└── .gitignore          # Git exclusions
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ACCESS_PASSWORD` | Plain text password for access | Yes |
| `SESSION_SECRET` | Secret key for cookie signing | Yes |
| `PASSWORD_HASH` | Auto-generated bcrypt hash | Auto |
| `NODE_ENV` | Environment (development/production) | No |
| `PORT` | Server port (default: 3000) | No |

## Troubleshooting

**Password Not Working?**
- Check the `.env` file has `ACCESS_PASSWORD` set
- Restart the server after changing the password
- Clear browser cookies if needed

**PWA Not Installing?**
- Ensure you're using HTTPS in production
- Check browser compatibility
- Verify manifest.json is accessible

**Gallery Not Working?**
- Check browser IndexedDB support
- Clear browser data if corrupted
- Verify sufficient storage space

## Security Notes

- Never commit the `.env` file to version control
- Use strong, unique passwords
- Consider additional security layers for production
- Regular security updates recommended