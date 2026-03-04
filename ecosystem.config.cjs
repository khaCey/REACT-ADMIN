module.exports = {
  apps: [
    {
      name: 'react-admin',
      cwd: 'C:/GitHub/REACT-ADMIN',
      script: 'server/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        API_PORT: '3002',
      },
    },
  ],
}

