/* 사이 mascot as a React component */
function Mascot({ state = "idle", size = 120, style = {} }) {
  return (
    <div className={"sai sai--" + state} style={{ ["--sai"]: size + "px", ...style }}>
      <div className="sai-rings"><i></i><i></i></div>
      <div className="sai-antenna"><b></b></div>
      <div className="sai-body">
        <div className="sai-gloss"></div>
        <div className="sai-face">
          <div className="sai-eyes"><span className="eye"><i></i></span><span className="eye"><i></i></span></div>
          <div className="sai-cheek l"></div><div className="sai-cheek r"></div>
          <div className="sai-mouth"></div>
        </div>
      </div>
      <div className="sai-spark s1">✦</div>
      <div className="sai-spark s2">✦</div>
      <div className="sai-think">···</div>
    </div>
  );
}
window.Mascot = Mascot;
