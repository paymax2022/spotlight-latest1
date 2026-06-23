export default function Breadcrumb({ breadcrumbTitle, className = "", headingPadding }) {
    return (
        <>
            <div className={`breadcrumb-wrapper banner-wrapper ${className}`.trim()}>
                <div className="page-heading" style={headingPadding ? { padding: headingPadding } : undefined}>
                    <img
                        src="/assets/img/shape/banner2.png"
                        alt={`${breadcrumbTitle} banner`}
                        style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
                    />
                </div>
            </div>

        </>
    )
}
