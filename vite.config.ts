import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        dedupe: ['react', 'react-dom'],
        alias: {
            react: path.resolve('./node_modules/react'),
            'react-dom': path.resolve('./node_modules/react-dom'),
        },
    },
    server: {
        host: true,
        port: 5173,
        strictPort: true,
        // Fix HMR WebSocket "ws://localhost:undefined/" when using --host
        hmr: {
            clientPort: 5173,
        },
    },
});
