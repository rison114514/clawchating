export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCronDaemon } = await import('./cron-daemon');
    startCronDaemon();
  }
}
