import { Link } from "react-router-dom";
import "./designPreview.css";

const heroMetrics = [
  { value: "3.1 млн", label: "операций в месяц" },
  { value: "120+", label: "складов в управлении" },
  { value: "24/7", label: "онлайн-контроль" },
];

const capabilityCards = [
  {
    title: "Единая карта склада",
    text: "Остатки, приемка, отгрузка и задачи в одном пространстве без переключения между системами.",
  },
  {
    title: "Точная трассировка операций",
    text: "Каждое действие фиксируется: кто, где и когда провел перемещение или подтверждение.",
  },
  {
    title: "Контроль через push и журнал",
    text: "Уведомления и журнал событий помогают не терять критичные изменения в работе команды.",
  },
];

const flowSteps = [
  "Приемка товара с проверкой по позициям и статусам.",
  "Размещение по локациям и автоматическая фиксация движения.",
  "Подбор, контроль отгрузки и аналитика отклонений.",
];

const faqItems = [
  {
    q: "Насколько быстро можно запустить склад?",
    a: "Базовый запуск обычно укладывается в 1 день: создаются роли, склады, сотрудники и стартовые процессы.",
  },
  {
    q: "Подходит ли для нескольких складов?",
    a: "Да, система масштабируется на сеть складов и позволяет видеть картину по каждой площадке отдельно.",
  },
  {
    q: "Есть мобильный режим для сотрудников?",
    a: "Да, доступен мобильный режим ТСД для операций прямо в зоне хранения и отгрузки.",
  },
];

export default function DesignPreview() {
  return (
    <div className="design-preview">
      <div className="design-preview__ambient design-preview__ambient--left" />
      <div className="design-preview__ambient design-preview__ambient--right" />

      <main className="design-preview__container">
        <header className="design-preview__header design-preview__animate-1">
          <Link className="design-preview__brand" to="/">
            <img src="/logo-mark.png" alt="СкладОнлайн" />
            <div>
              <strong>СкладОнлайн</strong>
              <span>Демо нового UI</span>
            </div>
          </Link>
          <div className="design-preview__actions">
            <Link className="design-preview__ghost-btn" to="/login">
              Ко входу
            </Link>
            <button type="button" className="design-preview__cta-btn">
              Запросить demo
            </button>
          </div>
        </header>

        <section className="design-preview__hero design-preview__animate-2">
          <div className="design-preview__hero-content">
            <span className="design-preview__tag">Платформа складского контроля</span>
            <h1>
              Центр управления складом, где каждая операция подтверждена
            </h1>
            <p>
              Это тестовая страница нового визуального стиля: мягкий градиентный
              фон, светлые карточки, акценты brand-blue и блочная архитектура
              лендинга из проекта `321`.
            </p>
            <div className="design-preview__hero-buttons">
              <button type="button" className="design-preview__cta-btn">
                Посмотреть сценарии
              </button>
              <button type="button" className="design-preview__ghost-btn">
                Открыть FAQ
              </button>
            </div>
          </div>

          <aside className="design-preview__hero-panel">
            <h2>Ключевые метрики</h2>
            <div className="design-preview__metric-grid">
              {heroMetrics.map((metric) => (
                <div key={metric.label} className="design-preview__metric-card">
                  <strong>{metric.value}</strong>
                  <span>{metric.label}</span>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="design-preview__section design-preview__animate-3">
          <div className="design-preview__section-head">
            <h2>Возможности</h2>
            <p>Три базовых блока для контроля склада в одной системе.</p>
          </div>
          <div className="design-preview__cards">
            {capabilityCards.map((card) => (
              <article key={card.title} className="design-preview__card">
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="design-preview__section design-preview__animate-4">
          <div className="design-preview__section-head">
            <h2>Как это работает</h2>
            <p>Логика блоков как в лендинге: структура + короткие сценарии.</p>
          </div>
          <ol className="design-preview__steps">
            {flowSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="design-preview__section design-preview__animate-5">
          <div className="design-preview__section-head">
            <h2>FAQ</h2>
            <p>Секция ответов в том же визуальном языке.</p>
          </div>
          <div className="design-preview__faq">
            {faqItems.map((item) => (
              <article key={item.q} className="design-preview__faq-item">
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="design-preview__bottom-cta design-preview__animate-6">
          <h2>Если визуал подходит, перенесем стиль на нужные страницы приложения</h2>
          <p>
            Это демо для сверки внешнего вида. После согласования можно
            адаптировать тот же подход для login/landing/внутренних экранов.
          </p>
          <div className="design-preview__hero-buttons">
            <button type="button" className="design-preview__cta-btn">
              Принять стиль
            </button>
            <Link className="design-preview__ghost-btn" to="/">
              Вернуться на текущий сайт
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
