module.exports = {
  apps: [
    {
      name: 'react-admin',
      cwd: 'C:/GitHub/REACT-ADMIN',
      script: 'npm',
      args: ['start'],
      interpreter: 'none',
      env: {
        API_PORT: '3002',
        NODE_ENV: 'production',
      },
    },
  ],
}

