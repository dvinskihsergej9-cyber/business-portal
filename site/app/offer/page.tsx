import Link from "next/link";

export default function OfferPage() {
  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8">
      <article className="rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_16px_42px_rgba(35,83,176,0.12)]">
        <h1 className="font-[var(--font-sora)] text-3xl font-semibold">Публичная оферта</h1>
        <p className="mt-2 text-sm text-slate-500">Редакция от 17 апреля 2026 г.</p>

        <div className="mt-6 space-y-4 text-sm leading-relaxed text-slate-700">
          <p>СкладОнлайн предоставляет доступ к облачному сервису управления складом по модели подписки.</p>
          <p>Акцептом оферты считается регистрация и/или оплата выбранного тарифа.</p>
          <p>Услуга оказывается дистанционно через интернет, без физической доставки.</p>
          <p>Доступ активируется автоматически после подтверждения оплаты платежным провайдером.</p>
          <p>Порядок возврата средств опубликован на странице <Link className="text-blue-600" href="/refund">«Возврат»</Link>.</p>
          <p>Контакты и реквизиты размещены на странице <Link className="text-blue-600" href="/contacts">«Контакты»</Link>.</p>
        </div>
      </article>
    </main>
  );
}
