export default function Breadcrumb({ breadcrumbTitle, className = "", headingPadding }) {
    return (
        <>
            <div className={`breadcrumb-wrapper banner-wrapper ${className}`.trim()}>
                <div className="page-heading" style={headingPadding ? { padding: headingPadding } : undefined}>
                    <img
                        src="/assets/img/shape/banner-home.png"
                        alt={`${breadcrumbTitle} banner`}
                    />
                </div>
            </div>

        </>
    )
}
