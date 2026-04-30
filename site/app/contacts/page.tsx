export default function ContactsPage() {
  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8">
      <article className="rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_16px_42px_rgba(35,83,176,0.12)]">
        <h1 className="font-[var(--font-sora)] text-3xl font-semibold">Контакты и реквизиты</h1>
        <div className="mt-6 grid gap-2 text-sm text-slate-700">
          <p>ИП Двинских Сергей Сергеевич</p>
          <p>ИНН: 743402272974</p>
          <p>ОГРНИП: 326745600045736</p>
          <p>Email: noreplyskladonline@mail.ru</p>
          <p>Телефон: +7-909-084-03-43</p>
          <p>Юридический адрес: г. Куса, ул. Розы Люксембург, д. 34, кв. 1</p>
          <p>Фактический адрес: г. Куса, ул. Розы Люксембург, д. 34, кв. 1</p>
        </div>
      </article>
    </main>
  );
}
