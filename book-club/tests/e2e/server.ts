import { createServer } from 'vite';
export default async function setup() {
  const server = await createServer({
    server: { host: '127.0.0.1', port: Number(process.env.E2E_PORT || 5173), strictPort: true },
  });
  await server.listen();
  return async () => {
    await server.close();
  };
}
