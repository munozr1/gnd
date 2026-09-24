/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: { '@': path.resolve(__dirname, 'src') },
    },
    build: {
        chunkSizeWarningLimit: 1500,
        rollupOptions: {
            output: {
                manualChunks: {
                    three: ['three', '@react-three/fiber', '@react-three/drei'],
                    konva: ['konva', 'react-konva'],
                },
            },
        },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        environmentMatchGlobs: [
            ['src/store/**', 'jsdom'],
            ['src/io/**', 'jsdom'],
            ['src/**/*.test.tsx', 'jsdom'],
        ],
        setupFiles: ['./src/test/setup.ts'],
    },
});
