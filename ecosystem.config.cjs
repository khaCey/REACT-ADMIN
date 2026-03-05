module.exports = {
  apps: [
    {
      name: 'GreenSquareAdmin',
      cwd: 'C:/GitHub/REACT-ADMIN',
      script: 'server/index.js',
      interpreter: 'node',
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        API_PORT: '3002',
        NODE_ENV: 'production',
      },
    },
  ],
}

