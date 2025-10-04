import { Link, NavLink } from 'react-router-dom'
import ThemeToggle from './ThemeToggle';

export default function NavBar() {
    return (
        <nav>
            <div className='px-2 flex justify-between items-center'> 
            <div className='flex gap-x-4'>
                <NavLink to={"/"} className={({ isActive }) => isActive ? "underline" : "text-gray-900 dark:text-gray-200"}>
                    Auto-Liver
                </NavLink>
                <NavLink to={"/upload"} className={({ isActive }) => isActive ? "underline" : "text-gray-900 dark:text-gray-200"}>
                    Upload
                </NavLink>
                <NavLink to={"/drafts"} className={({ isActive }) => isActive ? "underline" : "text-gray-900 dark:text-gray-200"}>
                    Drafts
                </NavLink>
                <NavLink to={"/scans"} className={({ isActive }) => isActive ? "underline" : "text-gray-900 dark:text-gray-200"}>
                    Scans
                </NavLink>
            </div>
            <div>
                <ThemeToggle/>
            </div>
            </div>
        </nav>
    );
}