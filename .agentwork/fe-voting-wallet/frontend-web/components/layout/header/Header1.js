import Link from 'next/link';
import Menu from '../Menu';
import OnePageNav from '../OnePageNav';

export default function Header1({ scroll, handleOffCanvas, handleSearch, onePageNav }) {
  return (
    <header>
      <div className="header-top-section fix">
        <div className="container-fluid">
          <div className="header-top-wrapper">
            <ul className="contact-list">
              <li><i className="far fa-envelope" /><a href="mailto:info@spotlightng.com" className="link">info@spotlightng.com</a></li>
              <li><i className="fa-solid fa-phone-volume" /><a href="tel:+2348063437144">+234 806 343 7144</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div id="header-sticky" className={`header-1 ${scroll ? 'sticky' : ''}`}>
        <div className="container-fluid"><div className="mega-menu-wrapper"><div className="header-main style-2"><div className="header-left"><div className="logo"><Link href="/" className="header-logo"><img src="/assets/img/logo/logo.png" alt="Spotlight logo" /></Link></div></div><div className="header-right d-flex justify-content-end align-items-center"><div className="mean__menu-wrapper"><div className="main-menu"><nav id="mobile-menu">{onePageNav ? <OnePageNav /> : <Menu />}</nav></div></div><a onClick={handleSearch} className="search-trigger search-icon"><i className="fal fa-search" /></a><div className="header-button"><Link href="/apply" className="theme-btn"><span>Apply Now<i className="fa-solid fa-arrow-right-long" /></span></Link></div><div className="header__hamburger d-xl-block my-auto"><div className="sidebar__toggle" onClick={handleOffCanvas}><i className="fas fa-bars" /></div></div></div></div></div></div>
      </div>
    </header>
  );
}
