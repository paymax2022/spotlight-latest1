'use client'
import Link from 'next/link'
import { useEffect } from 'react'

export default function Team1() {
    const followImageCursor = (event, teamItem) => {
        const contentBox = teamItem.getBoundingClientRect()
        const dx = Math.min(Math.max(event.clientX - contentBox.x, 0), contentBox.width)
        const dy = Math.min(Math.max(event.clientY - contentBox.y, 0), contentBox.height)
        teamItem.children[2].style.transform = `translate(${dx}px, ${dy}px) rotate(0)`
    }

    useEffect(() => {
        const teamItems = document.querySelectorAll(".team-items")

        const handleMouseMove = (event) => {
            teamItems.forEach((item) => {
                followImageCursor(event, item)
            })
        }

        document.addEventListener("mousemove", handleMouseMove)

        return () => {
            document.removeEventListener("mousemove", handleMouseMove)
        }
    }, [])
    return (
        <>
            
        </>
    )
}
