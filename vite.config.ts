import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
/* `npm run dev` の画面から、別に起動した `npm run cf:dev`（Worker・D1・R2のローカル版）のAPIを使う。 */
export default defineConfig({plugins:[react()],server:{proxy:{'/api':'http://localhost:8787'}},test:{environment:'node'}});
