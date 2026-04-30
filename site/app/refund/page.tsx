export default function RefundPage() {
  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8">
      <article className="rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_16px_42px_rgba(35,83,176,0.12)]">
        <h1 className="font-[var(--font-sora)] text-3xl font-semibold">Возврат</h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-slate-700">
          <p>Услуга цифровая: предоставляется доступ к сервису «СкладОнлайн».</p>
          <p>Если доступ не был предоставлен, возможен возврат 100% оплаты по обращению пользователя.</p>
          <p>Запросы на возврат принимаются в течение 7 календарных дней по email noreplyskladonline@mail.ru.</p>
          <p>Срок рассмотрения обращения — до 10 рабочих дней.</p>
        </div>
      </article>
    </main>
  );
}
