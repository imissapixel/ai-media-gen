  module.exports = {
    apps: [{
      name: 'ai-media-gen',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3010
      }
    }]
  }