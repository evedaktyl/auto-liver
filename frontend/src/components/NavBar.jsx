import { Link, NavLink } from 'react-router-dom'
import ThemeToggle from './ThemeToggle';

export default function NavBar() {
    return (
        <nav>
            <div className='flex justify-between items-center'> 
            <div className='gap-x-4'>
                Auto-liver
                <NavLink to={"/upload"} className={({ isActive }) => isActive ? "text-[#8cd3d5]" : "text-gray-900 dark:text-gray-200"}>
                    Upload
                </NavLink>
                <NavLink to={"/drafts"} className={({ isActive }) => isActive ? "text-[#8cd3d5]" : "text-gray-900 dark:text-gray-200"}>
                    Drafts
                </NavLink>
                <NavLink to={"/scans"} className={({ isActive }) => isActive ? "text-[#8cd3d5]" : "text-gray-900 dark:text-gray-200"}>
                    Scans
                </NavLink>
            </div>
            <div>Username
                <ThemeToggle/>
            </div>
            </div>
        </nav>
    );
}