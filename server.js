const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Rate limiting storage
const rateLimitStore = new Map();

const app = express();
const PORT = process.env.PORT || 3010;

// Trust proxy for accurate IP detection
app.set('trust proxy', 1);

// Security middleware
const helmet = require('helmet');
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "https://n8n.xtend3d.com", "blob:"],
            mediaSrc: ["'self'", "blob:"],
            workerSrc: ["'self'"],
            manifestSrc: ["'self'"],
            frameAncestors: ["'self'"]
        }
    }
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files middleware (applied after authentication)
app.use('/manifest.json', express.static(path.join(__dirname, 'manifest.json')));
app.use('/sw.js', express.static(path.join(__dirname, 'sw.js')));
app.use('/logo.svg', express.static(path.join(__dirname, 'logo.svg')));

// Password hashing and verification
const SALT_ROUNDS = 12;
let hashedPassword = null;

// Initialize password hash
async function initializePassword() {
    try {
        // Check if we already have a hash stored
        if (process.env.PASSWORD_HASH) {
            hashedPassword = process.env.PASSWORD_HASH;
            console.log('✅ Using stored password hash');
            return;
        }

        // If no hash exists, we need ACCESS_PASSWORD to generate one
        const plainPassword = process.env.ACCESS_PASSWORD;
        if (!plainPassword || plainPassword === 'your_secure_password_here') {
            console.error('⚠️  No PASSWORD_HASH found and ACCESS_PASSWORD is not set!');
            console.error('⚠️  Please either:');
            console.error('   1. Set ACCESS_PASSWORD in your .env file, or');
            console.error('   2. Provide a valid PASSWORD_HASH');
            process.exit(1);
        }

        // Generate new hash and store it
        console.log('🔐 Generating password hash...');
        hashedPassword = await bcrypt.hash(plainPassword, SALT_ROUNDS);
        
        // Update .env file with the hash
        const envPath = path.join(__dirname, '.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        // Add PASSWORD_HASH if it doesn't exist, or update it if it does
        if (envContent.includes('PASSWORD_HASH=')) {
            envContent = envContent.replace(/PASSWORD_HASH=.*/, `PASSWORD_HASH=${hashedPassword}`);
        } else {
            envContent += `\nPASSWORD_HASH=${hashedPassword}`;
        }
        
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Password hash generated and saved to .env');

        // Now, remove ACCESS_PASSWORD from .env file
        let updatedEnvContent = fs.readFileSync(envPath, 'utf8');
        const lines = updatedEnvContent.split('\n');
        const filteredLines = lines.filter(line => !line.startsWith('ACCESS_PASSWORD='));
        updatedEnvContent = filteredLines.join('\n');

        // Write the cleaned content back
        fs.writeFileSync(envPath, updatedEnvContent);
        console.log('🗑️ ACCESS_PASSWORD has been automatically removed from .env for security.');
        
    } catch (error) {
        console.error('❌ Error initializing password:', error);
        process.exit(1);
    }
}

// Authentication middleware
function requireAuth(req, res, next) {
    const authToken = req.cookies.auth_token;
    
    if (authToken && authToken === generateAuthToken()) {
        return next();
    }
    
    // Not authenticated - serve login page
    res.sendFile(path.join(__dirname, 'login.html'));
}

// Generate consistent auth token (based on session secret and password hash)
function generateAuthToken() {
    const crypto = require('crypto');
    return crypto
        .createHash('sha256')
        .update(process.env.SESSION_SECRET + hashedPassword)
        .digest('hex');
}

// Rate limiting middleware
function rateLimitLogin(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxAttempts = 5; // Max 5 attempts per window
    
    // Clean up old entries
    for (const [ip, data] of rateLimitStore.entries()) {
        if (now - data.windowStart > windowMs) {
            rateLimitStore.delete(ip);
        }
    }
    
    // Get or create rate limit data for this IP
    let limitData = rateLimitStore.get(clientIP);
    if (!limitData || now - limitData.windowStart > windowMs) {
        limitData = {
            attempts: 0,
            windowStart: now,
            lastAttempt: now
        };
        rateLimitStore.set(clientIP, limitData);
    }
    
    // Check if limit exceeded
    if (limitData.attempts >= maxAttempts) {
        const timeRemaining = Math.ceil((windowMs - (now - limitData.windowStart)) / 1000);
        return res.status(429).json({
            success: false,
            message: `Too many login attempts. Try again in ${Math.ceil(timeRemaining / 60)} minutes.`,
            retryAfter: timeRemaining
        });
    }
    
    // Increment attempts counter
    limitData.attempts++;
    limitData.lastAttempt = now;
    rateLimitStore.set(clientIP, limitData);
    
    next();
}

// Routes
app.post('/login', rateLimitLogin, async (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password is required' 
            });
        }
        
        // Verify password
        const isValid = await bcrypt.compare(password, hashedPassword);
        
        if (isValid) {
            // Reset rate limit on successful login
            const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
            rateLimitStore.delete(clientIP);
            
            // Set persistent cookie (1 year)
            const authToken = generateAuthToken();
            res.cookie('auth_token', authToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
                sameSite: 'Strict'
            });
            
            console.log(`✅ Successful login at ${new Date().toISOString()}`);
            res.json({ success: true, message: 'Authentication successful' });
        } else {
            console.log(`❌ Failed login attempt at ${new Date().toISOString()}`);
            res.status(401).json({ 
                success: false, 
                message: 'Invalid password' 
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Logout route
app.post('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true, message: 'Logged out successfully' });
});

// Protected routes
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'ai_content_gen.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        authenticated: !!req.cookies.auth_token
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        success: false, 
        message: 'Internal server error' 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        message: 'Not found' 
    });
});

// Start server
async function startServer() {
    try {
        await initializePassword();
        
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
            console.log(`🔐 Authentication enabled`);
            console.log(`📱 PWA ready`);
            console.log(`\n📝 Setup Instructions:`);
            console.log(`1. Install dependencies: npm install`);
            console.log(`2. Update .env file with your password`);
            console.log(`3. Start server: npm start`);
            console.log(`4. Visit http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();