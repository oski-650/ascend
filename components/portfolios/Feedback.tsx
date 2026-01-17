import RevealText from "../animation/RevealText";

// Define the shape of a single feedback item
interface FeedbackItem {
  quote: string;
  clientName: string;
  clientPosition: string;
  clientCompany: { name: string; url: string };
}

// Props for the component
interface FeedbackProps {
  feedbacks: FeedbackItem[];
}

export default function Feedback({ feedbacks }: FeedbackProps) {
  return (
    <div className="mxd-project__block">
      <div className="container-fluid px-0">
        <div className="row gx-0">
          <div className="col-12 col-xl-5 mxd-grid-item no-margin">
            <div className="mxd-project__subtitle">
              <RevealText as="h2" className="reveal-type anim-uni-in-up">
                Client&apos;s
                <br />
                feedback
              </RevealText>
            </div>
          </div>
          <div className="col-12 col-xl-6 mxd-grid-item no-margin">
            <div className="mxd-project__content">
              {feedbacks.map((item, index) => (
                <div key={index} className="mxd-project__paragraph medium-text">
                  <p className="anim-uni-in-up">{item.quote}</p>
                  <div className="mxd-project__client anim-uni-in-up">
                    <h5 className="anim-uni-in-up">{item.clientName}</h5>
                    <p className="t-small anim-uni-in-up">
                      {item.clientPosition} of {" "}
                      <a href={item.clientCompany.url}>{item.clientCompany.name}</a>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}