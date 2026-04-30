export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8">
      <article className="rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_16px_42px_rgba(35,83,176,0.12)]">
        <h1 className="font-[var(--font-sora)] text-3xl font-semibold">Политика обработки персональных данных</h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-slate-700">
          <p>Мы обрабатываем персональные данные пользователей для регистрации, авторизации, исполнения договора и поддержки работы сервиса.</p>
          <p>Данные хранятся в защищенной PostgreSQL базе и используются только в рамках функциональности платформы.</p>
          <p>Пользователь может запросить изменение или удаление своих данных по контактам на странице реквизитов.</p>
        </div>
      </article>
    </main>
  );
}
