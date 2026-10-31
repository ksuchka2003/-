import { createServer } from 'vite';
export default async function setup() {
  const port = Number(process.env.E2E_PORT || 5173);
  const server = await createServer({
    server: { host: '127.0.0.1', port, strictPort: true },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    },
  });
  await server.listen();
  const account = await createServer({
    server: { host: '127.0.0.1', port: port + 1, strictPort: true },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://bookclub.test.invalid'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-public-key'),
    },
  });
  await account.listen();
  return async () => {
    await server.close();
    await account.close();
  };
}
