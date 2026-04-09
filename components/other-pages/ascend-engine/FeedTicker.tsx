const FEED_ITEMS = [
  { icon: "ph-phone-incoming", text: "Incoming call handled", detail: "Roofing inquiry — San Jose, CA" },
  { icon: "ph-check-circle", text: "Lead qualified", detail: "Emergency HVAC repair — $800 est." },
  { icon: "ph-file-text", text: "Quote sent", detail: "$2,500 — Full roof replacement" },
  { icon: "ph-calendar-check", text: "Appointment booked", detail: "Tuesday 9:00 AM — Confirmed" },
  { icon: "ph-chat-dots", text: "Follow-up dispatched", detail: "Quote #1042 — 24hr nudge sent" },
  { icon: "ph-currency-dollar", text: "Payment received", detail: "$3,800 — Job #0291 closed" },
  { icon: "ph-star", text: "Review requested", detail: "5-star prompt sent to Michael T." },
  { icon: "ph-lightning", text: "After-hours lead captured", detail: "Plumbing emergency — 11:43 PM" },
];

export default function FeedTicker() {
  const doubled = [...FEED_ITEMS, ...FEED_ITEMS];

  return (
    <div className="ae-feed">
      <div className="ae-feed__track-wrap">
        <div className="ae-feed__track">
          {doubled.map((item, i) => (
            <div key={i} className="ae-feed__item">
              <div className="ae-feed__item-icon">
                <i className={`ph-bold ${item.icon}`} />
              </div>
              <div className="ae-feed__item-body">
                <span className="ae-feed__item-system">System:</span>
                <span className="ae-feed__item-text"> {item.text}</span>
                <p className="ae-feed__item-detail">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
