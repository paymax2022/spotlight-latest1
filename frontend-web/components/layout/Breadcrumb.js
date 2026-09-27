export default function Breadcrumb({ breadcrumbTitle, className = "", headingPadding }) {
    return (
        <>
            <div className={`breadcrumb-wrapper banner-wrapper ${className}`.trim()}>
                <div
                    className="page-heading"
                    style={{
                        position: "relative",
                        height: "clamp(160px, 22vw, 320px)",
                        overflow: "hidden",
                        ...(headingPadding ? { padding: headingPadding } : null),
                    }}
                >
                    <img
                        src="/assets/img/shape/banner-home.png"
                        alt={`${breadcrumbTitle} banner`}
                        style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            display: "block",
                            objectFit: "cover",
                        }}
                    />
                </div>
            </div>

        </>
    )
}
